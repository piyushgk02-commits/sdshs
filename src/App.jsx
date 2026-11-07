import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Archive, ArrowDownLeft, ArrowUpRight, Bell, Bus, CalendarCheck, Check, ChevronDown,
  ChevronLeft, ChevronRight, CircleHelp, ClipboardCheck, Clock3, Download, FileChartColumn,
  FileText, GraduationCap, LayoutDashboard, Menu, MoreHorizontal, Package, Plus, Search,
  LogOut, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, UserRoundCog, Users, Wallet, Wrench, X, XCircle,
} from 'lucide-react';
import AcademicDashboard from './AcademicDashboard.jsx';
import AcademicStaffManagement from './AcademicStaffManagement.jsx';
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { loadDemoState, money, number } from './data.js';
import {
  requestAdminEmailOtp, revokeAcademicPasswordSession, revokeAdminEmailSession, sessionFromAuth,
  setRememberSession, supabase, supabaseConfigured, verifyAdminEmailOtp,
} from './supabase.js';

const navigation = [
  { section: 'WORKSPACE', items: [
    ['Overview', 'overview', LayoutDashboard], ['Students', 'students', GraduationCap],
    ['Employees', 'employees', Users], ['Attendance', 'attendance', CalendarCheck],
    ['Approvals', 'approvals', ClipboardCheck], ['Finance', 'finance', Wallet],
  ] },
  { section: 'CAMPUS', items: [
    ['Transport', 'transport', Bus], ['Facilities', 'facilities', Wrench],
    ['Inventory', 'inventory', Package], ['Departments', 'departments', SlidersHorizontal],
    ['Reports', 'reports', FileChartColumn],
  ] },
  { section: 'ADMINISTRATION', items: [
    ['AI assistant', 'assistant', Sparkles], ['Academic staff', 'academicStaff', UserRoundCog], ['Users & settings', 'settings', Settings2],
    ['Audit log', 'audit', ShieldCheck],
  ] },
];

const currencyTooltip = (value) => money(value);

function App() {
  const [data, setData] = useState(loadDemoState);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!supabaseConfigured);
  const [authError, setAuthError] = useState('');
  const [adminMfaPending, setAdminMfaPending] = useState(false);
  const [passwordSetupMode, setPasswordSetupMode] = useState(() => {
    const flow = new URLSearchParams(window.location.search).get('flow');
    if (flow === 'academic' || flow === 'academic-password') return 'set-password';
    if (flow === 'password-reset') return 'reset-password';
    return '';
  });
  const [passwordSetupEmail, setPasswordSetupEmail] = useState('');
  const passwordSetupModeRef = useRef(Boolean(passwordSetupMode));
  const [page, setPage] = useState('overview');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [pageNumber, setPageNumber] = useState(1);
  const [mobileNav, setMobileNav] = useState(false);
  const [selected, setSelected] = useState(null);
  const [studentForm, setStudentForm] = useState(null);
  const [assetForm, setAssetForm] = useState(null);
  const [leaveForm, setLeaveForm] = useState(false);
  const [transactionForm, setTransactionForm] = useState(false);
  const [feePaymentStudent, setFeePaymentStudent] = useState(null);
  const [toast, setToast] = useState('');
  const rolePermissions = session?.role === 'Director'
    ? navigation.flatMap((group) => group.items.map(([, key]) => key))
    : session?.role === 'Principal'
      ? [...new Set([...(data.settings.principalPermissions || []), 'academicStaff'])]
      : [];
  const visibleNavigation = navigation.map((group) => ({
    ...group,
    items: group.items.filter(([, key]) => rolePermissions.includes(key)),
  }));

  useEffect(() => {
    localStorage.setItem('school-command-demo', JSON.stringify(data));
  }, [data]);

  useEffect(() => {
    if (!supabaseConfigured) return undefined;
    let active = true;
    let authRequest = 0;
    const resolveSession = async (authSession) => {
      if (passwordSetupModeRef.current) return;
      const requestNumber = ++authRequest;
      try {
        const result = authSession ? await sessionFromAuth(authSession) : null;
        if (!active || requestNumber !== authRequest) return;
        const pendingMfa = Boolean(result?.pendingMfa);
        const nextSession = pendingMfa ? null : result;
        setSession(nextSession);
        setAdminMfaPending(pendingMfa);
        if (authSession && !nextSession && !pendingMfa) {
          setAuthError('This account is not authorized for the selected SCHOOL COMMAND sign-in path.');
          window.setTimeout(() => { void supabase.auth.signOut({ scope: 'local' }); }, 0);
        } else if (nextSession) {
          setAuthError('');
        } else if (pendingMfa) {
          setAuthError('');
        }
      } catch {
        if (!active || requestNumber !== authRequest) return;
        setSession(null);
        setAdminMfaPending(false);
        setAuthError('Unable to verify your account or staff assignment. Please try again.');
        if (authSession) window.setTimeout(() => { void supabase.auth.signOut({ scope: 'local' }); }, 0);
      } finally {
        if (active && requestNumber === authRequest) setAuthReady(true);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, authSession) => {
      window.setTimeout(() => { void resolveSession(authSession); }, 0);
    });
    const initializeSession = async () => {
      if (passwordSetupModeRef.current) {
        const url = new URL(window.location.href);
        url.searchParams.delete('flow');
        window.history.replaceState(window.history.state, '', url);
        try {
          const { data: result, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!active) return;
          if (!result.session?.user?.email) {
            setAuthError('This password setup link is invalid or expired. Request a new staff invitation or password reset.');
          } else {
            setPasswordSetupEmail(result.session.user.email);
          }
          setAuthReady(true);
        } catch {
          if (active) {
            setAuthError('Unable to verify this password setup link. Request a new invitation or password reset.');
            setAuthReady(true);
          }
        }
        return;
      }

      const callbackParams = new URLSearchParams(window.location.search);
      const callbackHash = new URLSearchParams(window.location.hash.slice(1));
      if (callbackParams.has('error') || callbackHash.has('error')) {
        setAuthError('Sign-in could not be completed. Please try again.');
        callbackParams.delete('error');
        callbackParams.delete('error_code');
        callbackParams.delete('error_description');
        callbackHash.delete('error');
        callbackHash.delete('error_code');
        callbackHash.delete('error_description');
        const cleanedUrl = new URL(window.location.href);
        cleanedUrl.search = callbackParams.toString();
        cleanedUrl.hash = callbackHash.toString();
        window.history.replaceState(window.history.state, '', cleanedUrl);
      }

      try {
        const { data: result, error } = await supabase.auth.getSession();
        if (error) throw error;
        await resolveSession(result.session);
      } catch {
        if (active) {
          setAuthError('Unable to verify your sign-in. Please try again.');
          setAuthReady(true);
        }
      }
    };
    void initializeSession();
    return () => {
      active = false;
      authRequest += 1;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const setView = (view, nextFilter = 'All') => {
    if (!rolePermissions.includes(view)) return;
    setPage(view);
    setFilter(nextFilter);
    setQuery('');
    setPageNumber(1);
    setSelected(null);
    setMobileNav(false);
  };

  const addAudit = (action, record) => {
    setData((current) => ({ ...current, audit: [{ id: `AU-${Date.now()}`, user: `${session?.name || 'Demo'} · ${session?.role || 'Demo'}`, action, record, time: new Date().toLocaleString('en-IN') }, ...current.audit] }));
  };

  const loginWithPassword = async ({ email, password, remember }) => {
    if (!supabaseConfigured) return 'Secure sign-in is unavailable until Supabase is configured.';
    setRememberSession(remember);
    const { data: result, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error || !result.session) return 'Email or password is incorrect.';
    try {
      const nextSession = await sessionFromAuth(result.session);
      if (nextSession?.pendingMfa) {
        setSession(null);
        setAdminMfaPending(true);
        setAuthError('');
        return '';
      }
      if (!nextSession) {
        await supabase.auth.signOut({ scope: 'local' });
        return 'This account is not active or assigned to SCHOOL COMMAND.';
      }
      setSession(nextSession);
      setAdminMfaPending(false);
      setAuthError('');
      return '';
    } catch {
      await supabase.auth.signOut({ scope: 'local' });
      return 'Unable to verify your account or staff assignment. Please try again.';
    }
  };

  const requestPasswordReset = async (email) => {
    if (!supabaseConfigured) return 'Secure sign-in is unavailable until Supabase is configured.';
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: new URL('/?flow=password-reset', window.location.origin).toString(),
    });
    return error
      ? 'Unable to send a password reset email. Please try again later.'
      : 'If this address belongs to an account, password reset instructions will be sent.';
  };

  const finishPasswordSetup = async (password) => {
    if (!supabaseConfigured) return 'Secure sign-in is unavailable until Supabase is configured.';
    const { data: current, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !current.session) return 'This password setup link is invalid or expired.';
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return 'Unable to set this password. Use at least 10 characters and try again.';
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
    if (signOutError) return 'Password saved, but sign-out failed. Close this browser session before signing in.';
    passwordSetupModeRef.current = false;
    setPasswordSetupMode('');
    setAuthError('Password saved. Sign in with your email and password.');
    return '';
  };

  const requestAdminOtp = async () => requestAdminEmailOtp();

  const verifyAdminOtp = async (code) => {
    const error = await verifyAdminEmailOtp(code);
    if (error) return error;
    try {
      const { data: sessionResult, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const nextSession = await sessionFromAuth(sessionResult.session);
      if (!nextSession || nextSession.pendingMfa
        || !['Director', 'Principal'].includes(nextSession.role)) {
        return 'Unable to verify administrator access. Please sign in again.';
      }
      setSession(nextSession);
      setAdminMfaPending(false);
      setAuthError('');
      setData((current) => ({
        ...current,
        audit: [{
          id: `AU-${Date.now()}`,
          user: `${nextSession.name} · ${nextSession.role}`,
          action: 'authenticated sign-in with email verification',
          record: 'Email and password with email OTP',
          time: new Date().toLocaleString('en-IN'),
        }, ...current.audit],
      }));
      setToast('Administrator verification complete');
      return '';
    } catch {
      return 'Unable to verify administrator access. Please sign in again.';
    }
  };

  const cancelAdminOtp = async () => {
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      setAdminMfaPending(false);
      setSession(null);
      setAuthError('');
    } catch {
      setAuthError('Unable to safely cancel this administrator sign-in. Please try again.');
    }
  };

  const logout = async () => {
    addAudit('authenticated sign-out', 'Supabase Auth');
    const sessionInvalidationError = session && ['Director', 'Principal'].includes(session.role)
      ? await revokeAdminEmailSession()
      : session && ['Class Coordinator', 'Class Teacher'].includes(session.role)
        ? await revokeAcademicPasswordSession()
        : '';
    let signOutError = '';
    try {
      if (supabaseConfigured) {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) throw error;
      }
    } catch {
      signOutError = 'Unable to complete sign-out. Please close this browser session and try again.';
    } finally {
      setSession(null);
      setAdminMfaPending(false);
      if (sessionInvalidationError || signOutError) setAuthError(sessionInvalidationError || signOutError);
      setView('overview');
    }
  };

  const expenses = data.transactions.filter((item) => item.type === 'Expense' && ['Approved', 'Cleared'].includes(item.status));
  const income = data.transactions.filter((item) => item.type === 'Income' && ['Approved', 'Cleared'].includes(item.status));
  const totalExpenses = expenses.reduce((sum, item) => sum + item.amount, 0);
  const totalIncome = income.reduce((sum, item) => sum + item.amount, 0);
  const pendingLeaves = data.leaves.filter((leave) => leave.status === 'Pending').length;
  const attentionRooms = data.rooms.filter((room) => room.condition === 'Attention');
  const outstandingFees = data.students.reduce((sum, student) => sum + Math.max(0, student.feeTotal - student.feePaid), 0);
  const collectionRate = Math.round((data.students.reduce((sum, student) => sum + student.feePaid, 0) / data.students.reduce((sum, student) => sum + student.feeTotal, 0)) * 100);

  const searchRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    let rows = [];
    if (page === 'students') {
      rows = data.students.filter((item) => filter === 'All' || item.className === filter);
      if (normalized) rows = rows.filter((item) => `${item.name} ${item.id} ${item.guardian} ${item.className} ${item.section}`.toLowerCase().includes(normalized));
    } else if (page === 'employees') {
      rows = data.employees.filter((item) => filter === 'All' || item.type === filter);
      if (normalized) rows = rows.filter((item) => `${item.name} ${item.id} ${item.department} ${item.designation}`.toLowerCase().includes(normalized));
    } else if (page === 'finance') {
      rows = data.transactions.filter((item) => filter === 'All' || item.type === filter);
      if (normalized) rows = rows.filter((item) => `${item.id} ${item.category} ${item.description} ${item.vendor}`.toLowerCase().includes(normalized));
    } else if (page === 'transport') {
      rows = data.vehicles;
      if (normalized) rows = rows.filter((item) => `${item.id} ${item.registration} ${item.driver} ${item.route}`.toLowerCase().includes(normalized));
    } else if (page === 'facilities') {
      rows = data.rooms.filter((item) => filter === 'All' || item.condition === filter);
      if (normalized) rows = rows.filter((item) => `${item.id} ${item.type} ${item.assigned} ${item.issue}`.toLowerCase().includes(normalized));
    } else if (page === 'approvals') {
      rows = data.leaves.filter((item) => filter === 'All' || item.status === filter);
      if (normalized) rows = rows.filter((item) => `${item.employee} ${item.id} ${item.employeeId} ${item.reason}`.toLowerCase().includes(normalized));
    }
    return rows;
  }, [data, page, query, filter]);

  const openRecord = (record, type) => setSelected({ ...record, recordType: type });

  const approveLeave = (leave, decision) => {
    setData((current) => ({ ...current, leaves: current.leaves.map((item) => item.id === leave.id ? { ...item, status: decision, approver: 'Glenn · Demo', decisionDate: new Date().toLocaleString('en-IN'), comments: `Marked ${decision.toLowerCase()} in the demo workspace` } : item) }));
    addAudit(`${decision} leave application`, leave.id);
    setToast(`${leave.id} ${decision.toLowerCase()}`);
  };

  const submitLeave = (leave) => {
    const record = { ...leave, id: `LV-${String(Date.now()).slice(-6)}`, status: 'Pending', applicationDate: new Date().toLocaleDateString('en-GB') };
    setData((current) => ({ ...current, leaves: [record, ...current.leaves] }));
    addAudit('submitted leave application', record.id);
    setLeaveForm(false);
    setToast('Leave application submitted for review');
  };

  const saveStudent = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const record = {
      ...(studentForm?.id ? data.students.find((student) => student.id === studentForm.id) : { id: `SD-${Date.now().toString().slice(-6)}`, attendance: 100, todayStatus: 'Present', feeTotal: 28000, feePaid: 0, payments: [], admissionDate: new Date().toLocaleDateString('en-GB') }),
      name: form.get('name'), className: form.get('className'), section: form.get('section'),
      guardian: form.get('guardian'), phone: form.get('phone'), gender: form.get('gender'),
    };
    setData((current) => ({ ...current, students: studentForm?.id ? current.students.map((student) => student.id === record.id ? record : student) : [record, ...current.students] }));
    addAudit(studentForm?.id ? 'updated student' : 'created student', record.id);
    setStudentForm(null);
    setToast(studentForm?.id ? 'Student record updated' : 'Student record created');
  };

  const reverseTransaction = (transaction) => {
    setData((current) => ({ ...current, transactions: current.transactions.map((item) => item.id === transaction.id ? { ...item, status: 'Reversed' } : item) }));
    addAudit('reversed financial transaction', transaction.id);
    setToast(`${transaction.id} reversed with audit history`);
  };

  const saveTransaction = (values) => {
    const record = {
      ...values,
      id: `TX-${Date.now().toString().slice(-8)}`,
      status: values.type === 'Income' ? 'Cleared' : 'Approved',
      createdBy: `${session.name} · Demo`,
      supportingDocument: 'Not attached · demo record',
    };
    setData((current) => ({ ...current, transactions: [record, ...current.transactions] }));
    addAudit('created financial transaction', record.id);
    setTransactionForm(false);
    setToast(`${record.type} transaction recorded`);
  };

  const recordFeePayment = (student, values) => {
    const balance = Math.max(0, student.feeTotal - student.feePaid);
    if (values.amount > balance) {
      setToast('Payment exceeds the student outstanding balance');
      return;
    }
    const payment = { ...values, id: `RCPT-${Date.now().toString().slice(-8)}`, status: 'Cleared' };
    const transaction = {
      id: `FE-${Date.now().toString().slice(-8)}`, date: payment.date, category: 'Student fee collection',
      description: `Student fee receipt · ${student.name}`, vendor: student.name, amount: payment.amount,
      method: payment.method, reference: payment.reference, type: 'Income', status: 'Cleared',
      createdBy: `${session.name} · Demo`, supportingDocument: 'Not attached · demo record',
    };
    setData((current) => ({
      ...current,
      students: current.students.map((item) => item.id === student.id
        ? { ...item, feePaid: item.feePaid + payment.amount, payments: [payment, ...(item.payments || [])] }
        : item),
      transactions: [transaction, ...current.transactions],
    }));
    addAudit('recorded student fee payment', payment.id);
    setFeePaymentStudent(null);
    setToast(`Receipt recorded · ${money(payment.amount)}`);
  };

  const saveAsset = (asset) => {
    setData((current) => ({ ...current, assets: asset.id ? current.assets.map((item) => item.id === asset.id ? asset : item) : [{ ...asset, id: `AST-${String(Date.now()).slice(-6)}` }, ...current.assets] }));
    addAudit(asset.id ? 'updated inventory asset' : 'created inventory asset', asset.id || asset.name);
    setAssetForm(null);
    setToast(asset.id ? 'Asset record updated' : 'Asset record created');
  };

  const saveSettings = (settings) => {
    setData((current) => ({ ...current, settings }));
    addAudit('updated school settings', settings.schoolName);
    setToast('School settings saved in this browser');
  };

  const markAttendance = (audience, id, status) => {
    const key = audience === 'Students' ? 'students' : 'employees';
    const record = data[key].find((item) => item.id === id);
    setData((current) => ({ ...current, [key]: current[key].map((item) => item.id === id ? { ...item, todayStatus: status } : item) }));
    addAudit(`marked ${audience.toLowerCase()} attendance ${status.toLowerCase()}`, id);
    setToast(`${record?.name || id} marked ${status.toLowerCase()}`);
  };

  if (!authReady) return <div className="auth-loading" role="status">Checking secure sign-in…</div>;
  if (!session) return <LoginScreen
    authEnabled={supabaseConfigured}
    authError={authError}
    initialMode={passwordSetupMode || (adminMfaPending ? 'admin-mfa' : 'login')}
    initialEmail={passwordSetupEmail}
    onSignIn={loginWithPassword}
    onRequestAdminOtp={requestAdminOtp}
    onVerifyAdminOtp={verifyAdminOtp}
    onCancelAdminOtp={cancelAdminOtp}
    onRequestPasswordReset={requestPasswordReset}
    onFinishPasswordSetup={finishPasswordSetup}
  />;
  if (['Class Coordinator', 'Class Teacher'].includes(session.role)) {
    return <AcademicDashboard session={session} supabase={supabase} onLogout={logout} />;
  }

  return (
    <div className="app-shell">
      {mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><span>SD</span><i /></div>
          <div><strong>SCHOOL<span>COMMAND</span></strong><small>ST DOMINIC SAVIO'S HIGH SCHOOL</small></div>
          <button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={18} /></button>
        </div>
        <div className="school-switcher"><div className="school-avatar">S</div><div><b>St Dominic Savio's</b><span>High School · 2026–27</span></div><ChevronDown size={15} /></div>
        <nav className="nav-list" aria-label="Main navigation">
          {visibleNavigation.map((group) => <div className="nav-group" key={group.section}>
            <p>{group.section}</p>
            {group.items.map(([label, key, Icon]) => <button key={key} className={`nav-item ${page === key ? 'active' : ''}`} onClick={() => setView(key)}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{key === 'approvals' && pendingLeaves > 0 && <em>{pendingLeaves}</em>}
            </button>)}
          </div>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="support-card"><CircleHelp size={17} /><div><b>Need a hand?</b><span>Demo workspace</span></div><ChevronRight size={15} /></div>
          <div className="user-card"><div className="user-avatar">{session.name[0]}</div><div><b>{session.name}</b><span>{session.role} · Authorized</span></div><button className="icon-button" aria-label="Log out" title="Log out" onClick={logout}><LogOut size={17} /></button></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><b>{pageLabel(page)}</b></div>
          <div className="topbar-actions"><div className="academic-pill"><span className="live-dot" /> Academic year <b>2026–27</b></div><button className="icon-button notification-button" aria-label="Notifications" onClick={() => setView('approvals')}><Bell size={18} /><i /></button><div className="topbar-user">{session.name[0]}</div></div>
        </header>
        <div className="demo-banner"><span><b>{session.authenticated ? 'SUPABASE AUTH' : 'DEMO MODE'}</b><i /> Fictional school records are stored in this browser only; they are not cloud-synchronized.</span><button onClick={() => setView('settings')}>Configure deployment <ChevronRight size={14} /></button></div>

        <section className="page-content">
          {page === 'overview' && <Overview
            data={data} totalExpenses={totalExpenses} totalIncome={totalIncome} pendingLeaves={pendingLeaves}
            collectionRate={collectionRate} outstandingFees={outstandingFees} attentionRooms={attentionRooms} onNavigate={setView} onRecord={openRecord}
          />}
          {['students', 'employees', 'finance', 'transport', 'facilities', 'approvals'].includes(page) && <DirectoryPage
            page={page} rows={searchRows} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter}
            pageNumber={pageNumber} setPageNumber={setPageNumber} onRecord={openRecord}
            onAdd={() => setStudentForm({})} onAddLeave={() => setLeaveForm(true)} onAddTransaction={() => setTransactionForm(true)} onEdit={(row) => setStudentForm(row)} onDecision={approveLeave}
            onReverse={reverseTransaction} onToast={setToast} data={data}
          />}
          {page === 'attendance' && <AttendancePage data={data} onMark={markAttendance} onToast={setToast} />}
          {page === 'inventory' && <InformationPage data={data} onToast={setToast} onAdd={() => setAssetForm({})} onRecord={openRecord} />}
          {page === 'departments' && <DepartmentsPage data={data} onNavigate={setView} />}
          {page === 'reports' && <ReportsPage data={data} expenses={totalExpenses} income={totalIncome} onToast={setToast} />}
          {page === 'assistant' && <AssistantPage data={data} totalExpenses={totalExpenses} pendingLeaves={pendingLeaves} />}
          {page === 'academicStaff' && <AcademicStaffManagement supabase={supabase} />}
          {page === 'settings' && <SettingsPage settings={data.settings} authConnected={supabaseConfigured} onSave={saveSettings} />}
          {page === 'audit' && <AuditPage rows={data.audit} />}
        </section>
        <footer className="app-footer"><span>© 2026 St Dominic Savio's High School</span><span><i className="live-dot" /> Demo data · This browser</span></footer>
      </main>

      {selected && <RecordModal record={selected} onClose={() => setSelected(null)} onEdit={(row, type) => { setSelected(null); if (type === 'inventory') setAssetForm(row); else setStudentForm(row); }} onFeePayment={(student) => { setSelected(null); setFeePaymentStudent(student); }} onNavigate={setView} />}
      {studentForm && <StudentForm initial={studentForm} onClose={() => setStudentForm(null)} onSubmit={saveStudent} />}
      {assetForm && <AssetForm initial={assetForm} onClose={() => setAssetForm(null)} onSubmit={saveAsset} />}
      {leaveForm && <LeaveForm employees={data.employees} onClose={() => setLeaveForm(false)} onSubmit={submitLeave} />}
      {transactionForm && <TransactionForm onClose={() => setTransactionForm(false)} onSubmit={saveTransaction} />}
      {feePaymentStudent && <StudentFeeForm student={feePaymentStudent} onClose={() => setFeePaymentStudent(null)} onSubmit={(values) => recordFeePayment(feePaymentStudent, values)} />}
      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </div>
  );
}

function pageLabel(page) {
  return navigation.flatMap((group) => group.items).find((item) => item[1] === page)?.[0] || 'Overview';
}

function LoginScreen({
  authEnabled, authError, initialMode, initialEmail, onSignIn, onRequestAdminOtp, onVerifyAdminOtp,
  onCancelAdminOtp, onRequestPasswordReset, onFinishPasswordSetup,
}) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState(initialEmail || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(authError || '');
  const [notice, setNotice] = useState('');
  const [code, setCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (authError) setError(authError);
  }, [authError]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (initialEmail) setEmail(initialEmail);
  }, [initialEmail]);

  useEffect(() => {
    if (!resendCooldown) return undefined;
    const timer = window.setTimeout(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  const signIn = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await onSignIn({ email, password, remember });
      if (result) setError(result);
    } catch {
      setError('Unable to sign in right now. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const requestPasswordReset = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setNotice(await onRequestPasswordReset(email));
    } catch {
      setError('Unable to send password reset instructions right now. Please try again later.');
    } finally {
      setBusy(false);
    }
  };

  const finishPasswordSetup = async (event) => {
    event.preventDefault();
    if (password.length < 10) {
      setError('Use a password with at least 10 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await onFinishPasswordSetup(password);
      if (result) setError(result);
    } catch {
      setError('Unable to set the password. Request a new invitation or reset link.');
    } finally {
      setBusy(false);
    }
  };

  const requestAdminCode = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    setResendCooldown(60);
    try {
      const result = await onRequestAdminOtp();
      if (result) setError(result);
      else setNotice('A six-digit verification code was sent to your authorized administrator email.');
    } catch {
      setError('Unable to send a verification code right now. Please try again later.');
    } finally {
      setBusy(false);
    }
  };
  const verifyCode = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the six-digit verification code.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await onVerifyAdminOtp(code);
      if (result) setError(result);
    } catch {
      setError('Unable to verify the code right now. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const backToLogin = () => {
    setMode('login');
    setError('');
    setNotice('');
    setCode('');
  };

  const passwordMode = mode === 'set-password' || mode === 'reset-password';

  return <main className="login-page">
    <section className="login-card" aria-labelledby="login-heading">
      <div className="login-brand"><div className="brand-mark"><span>SD</span><i /></div><div><b>SCHOOL<span>COMMAND</span></b><small>ST DOMINIC SAVIO'S HIGH SCHOOL</small></div></div>
      <div className="login-demo-label"><span className="live-dot" /> SECURE SCHOOL ACCESS</div>
      <h1 id="login-heading">{mode === 'admin-mfa' ? 'Verify administrator sign-in' : mode === 'forgot-password' ? 'Reset your password' : passwordMode ? 'Set your password' : 'Sign in to SCHOOL COMMAND'}</h1>
      <p className="login-description">{mode === 'admin-mfa' ? 'Enter the six-digit code sent to your administrator email.' : passwordMode ? `Create a password for ${email || 'your invited account'}.` : 'St Dominic Savio’s High School'}</p>
      {!authEnabled && <div className="login-config-notice" role="status"><ShieldCheck size={17} /><span>Secure sign-in is not configured. Add <b>VITE_SUPABASE_URL</b> and <b>VITE_SUPABASE_ANON_KEY</b> to <b>.env.local</b>, then restart the app.</span></div>}
      {mode === 'login' && <form className="login-form" onSubmit={signIn}>
        <label>School email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label className="remember-control"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Remember this device</label>
        {error && <p className="login-error" role="alert">{error}</p>}
        {notice && <p className="login-success" role="status">{notice}</p>}
        <button className="button button-primary login-submit" type="submit" disabled={busy || !authEnabled}>{busy ? 'Signing in…' : 'Sign in'} <ChevronRight size={16} /></button>
        <button type="button" className="forgot-password" onClick={() => { setMode('forgot-password'); setError(''); setNotice(''); }} disabled={!authEnabled}>Forgot password?</button>
        <p className="login-invitation-note">Your role and access are set by the school administrator. Public registration is disabled.</p>
      </form>}
      {mode === 'admin-mfa' && <form className="login-form" onSubmit={verifyCode}>
        <label>Six-digit verification code<input className="otp-input" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        {notice && <p className="login-success" role="status">{notice}</p>}
        <button className="button button-primary login-submit" type="submit" disabled={busy || !authEnabled}>{busy ? 'Verifying…' : 'Verify code'} <Check size={16} /></button>
        <button type="button" className="forgot-password" onClick={requestAdminCode} disabled={busy || !authEnabled || resendCooldown > 0}>{busy ? 'Sending code…' : resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Send or resend verification code'}</button>
        <button type="button" className="login-back" onClick={() => { void onCancelAdminOtp(); }}>Cancel sign-in</button>
      </form>}
      {mode === 'forgot-password' && <form className="login-form" onSubmit={requestPasswordReset}>
        <label>School email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        {notice && <p className="login-success" role="status">{notice}</p>}
        <button className="button button-primary login-submit" type="submit" disabled={busy || !authEnabled}>{busy ? 'Sending…' : 'Send reset link'} <ChevronRight size={16} /></button>
        <button type="button" className="login-back" onClick={backToLogin}>Back to sign in</button>
      </form>}
      {passwordMode && <form className="login-form" onSubmit={finishPasswordSetup}>
        <label>New password<input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" minLength={10} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="button button-primary login-submit" type="submit" disabled={busy || !authEnabled}>{busy ? 'Saving…' : 'Save password'} <Check size={16} /></button>
      </form>}
      {mode === 'admin-mfa' && <p className="login-invitation-note">Password sign-in alone does not grant administrator access. The code expires after five minutes and can be used once.</p>}
      {mode === 'set-password' && <p className="login-invitation-note">This invitation is for an administrator-assigned academic staff account.</p>}
    </section>
    <footer className="login-footer">St Dominic Savio's High School <span>·</span> Academic year 2026–27</footer>
  </main>;
}

function Overview({ data, totalExpenses, totalIncome, pendingLeaves, collectionRate, outstandingFees, attentionRooms, onNavigate, onRecord }) {
  const students = data.students.length;
  const teachers = data.employees.filter((item) => item.type === 'Teaching').length;
  const other = data.employees.filter((item) => item.type === 'Other staff').length;
  const expenseRows = data.transactions.filter((item) => item.type === 'Expense' && item.status !== 'Reversed');
  const chartData = [{ month: 'November', income: totalIncome, expenses: totalExpenses }];
  const stats = [
    ['Total students', number(students), 'Students', GraduationCap, 'green'],
    ['Teaching staff', number(teachers), 'Teaching', Users, 'blue'],
    ['Other staff', number(other), 'Other staff', Users, 'gold'],
    ['Total employees', number(data.employees.length), 'All', Users, 'rose'],
    ['School vehicles', number(data.vehicles.length), 'Vehicles', Bus, 'green'],
    ['Rooms', number(data.rooms.length), 'Rooms', Wrench, 'blue'],
  ];
  return <>
    <div className="page-heading"><div><div className="eyebrow">THURSDAY, 06 NOVEMBER 2026 <span>·</span> GOOD MORNING, GLENN</div><h1>Executive overview</h1><p>Your school, at a glance.</p></div><div className="heading-actions"><button className="button button-secondary" onClick={() => window.print()}><Download size={16} /> Export overview</button><button className="button button-primary" onClick={() => onNavigate('approvals')}><ClipboardCheck size={16} /> Review decisions <span className="button-count">{pendingLeaves}</span></button></div></div>
    <div className="stats-grid">{stats.map(([label, value, filter, Icon, color]) => { const destinations = { Students: ['students', 'All'], Teaching: ['employees', 'Teaching'], 'Other staff': ['employees', 'Other staff'], All: ['employees', 'All'], Vehicles: ['transport', 'All'], Rooms: ['facilities', 'All'] }; const [view, nextFilter] = destinations[filter]; return <button className="stat-card" key={label} onClick={() => onNavigate(view, nextFilter)}><div className={`stat-icon ${color}`}><Icon size={19} /></div><span className="stat-label">{label}</span><b className="stat-value">{value}</b><span className="stat-foot">View records <ArrowUpRight size={14} /></span></button>; })}</div>
    <div className="overview-grid">
      <section className="panel chart-panel"><div className="panel-heading"><div><h2>Financial pulse</h2><p>Income and expenses · November 2026</p></div><button className="select-button" onClick={() => onNavigate('finance')}>View transactions <ChevronRight size={14} /></button></div><div className="chart-legend"><span><i className="legend-income" /> Income</span><span><i className="legend-expense" /> Expenses</span></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} barGap={5} onClick={(event) => event?.activePayload && onNavigate('finance')}><CartesianGrid vertical={false} stroke="#e9ece5" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#858a82', fontSize: 11 }} dy={9} /><YAxis axisLine={false} tickLine={false} tick={{ fill: '#858a82', fontSize: 10 }} tickFormatter={(value) => `${value / 100000}L`} width={35} /><Tooltip formatter={currencyTooltip} contentStyle={{ borderRadius: 8, border: '1px solid #e8e9e2', fontSize: 12 }} /><Bar dataKey="income" fill="#247447" radius={[4, 4, 0, 0]} maxBarSize={24} /><Bar dataKey="expenses" fill="#e2c866" radius={[4, 4, 0, 0]} maxBarSize={24} /></BarChart></ResponsiveContainer></div><div className="financial-totals"><button onClick={() => onNavigate('finance', 'Income')}><span>Monthly income</span><b>{money(totalIncome)}</b><em><ArrowDownLeft size={13} /> Fee collection</em></button><button onClick={() => onNavigate('finance', 'Expense')}><span>Monthly expenses</span><b>{money(totalExpenses)}</b><em><ArrowUpRight size={13} /> {expenseRows.length} transactions</em></button></div></section>
      <section className="panel collection-panel"><div className="panel-heading"><div><h2>Fee collection</h2><p>Collected fees vs billed fees · 2026–27</p></div><button className="more-button" aria-label="Open finance" onClick={() => onNavigate('finance')}><MoreHorizontal size={19} /></button></div><div className="collection-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ name: 'Collected', value: data.students.reduce((sum, student) => sum + student.feePaid, 0) }, { name: 'Outstanding', value: outstandingFees }]} dataKey="value" innerRadius={66} outerRadius={83} paddingAngle={3} startAngle={90} endAngle={-270} onClick={() => onNavigate('students')}><Cell fill="#247447" /><Cell fill="#edf0e9" /></Pie><Tooltip formatter={currencyTooltip} /></PieChart></ResponsiveContainer><div className="donut-label"><b>{collectionRate}%</b><span>collected</span></div></div><div className="collection-amount"><b>{money(data.students.reduce((sum, student) => sum + student.feePaid, 0))}</b><span>Student fees paid</span></div><div className="collection-foot"><span>Outstanding fees</span><button onClick={() => onNavigate('students')}>{money(outstandingFees)} <ChevronRight size={14} /></button></div></section>
    </div>
    <div className="lower-grid">
      <section className="panel approvals-panel"><div className="panel-heading"><div><h2>Pending decisions <span className="heading-badge">{pendingLeaves}</span></h2><p>Leave requests awaiting review</p></div><button className="text-link" onClick={() => onNavigate('approvals')}>View all <ChevronRight size={15} /></button></div><div className="compact-list">{data.leaves.filter((item) => item.status === 'Pending').slice(0, 4).map((leave) => <button className="compact-row" key={leave.id} onClick={() => onNavigate('approvals')}><div className="person-initial">{leave.employee[0]}</div><div className="compact-main"><b>{leave.employee}</b><span>{leave.category} leave · {leave.days} day{leave.days > 1 ? 's' : ''}</span></div><span className="pending-pill"><Clock3 size={12} /> Pending</span><ChevronRight size={15} /></button>)}</div></section>
      <section className="panel alerts-panel"><div className="panel-heading"><div><h2>Campus attention <span className="heading-badge warm">{attentionRooms.length}</span></h2><p>Facilities needing a follow-up</p></div><button className="text-link" onClick={() => onNavigate('facilities', 'Attention')}>All rooms <ChevronRight size={15} /></button></div><div className="alert-list">{attentionRooms.slice(0, 3).map((room) => <button className="alert-row" key={room.id} onClick={() => onRecord(room, 'room')}><span className="alert-marker"><Wrench size={15} /></span><span><b>{room.id}</b><small>{room.issue}</small></span><span className="alert-open">Open <ArrowUpRight size={13} /></span></button>)}</div><div className="alert-bottom"><Activity size={15} /><span>Next scheduled safety inspection</span><b>12 Nov</b></div></section>
    </div>
  </>;
}

function DirectoryPage({ page, rows, query, setQuery, filter, setFilter, pageNumber, setPageNumber, onRecord, onAdd, onAddLeave, onAddTransaction, onEdit, onDecision, onReverse, onToast, data }) {
  const pageSize = 10;
  const count = rows.length;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const shown = rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
  const configs = {
    students: { title: 'Student directory', subtitle: `${number(data.students.length)} enrolled students · 2026–27`, add: true, search: 'Search name, admission no., guardian…', filters: ['All', ...Array.from({ length: 12 }, (_, i) => String(i + 1))] },
    employees: { title: 'Employee directory', subtitle: `${number(data.employees.length)} employees · ${data.employees.filter((row) => row.type === 'Teaching').length} teaching · ${data.employees.filter((row) => row.type === 'Other staff').length} other staff`, search: 'Search name, employee ID, department…', filters: ['All', 'Teaching', 'Other staff'] },
    finance: { title: 'Finance & accounts', subtitle: 'Income, expenses and fee collection from linked transactions', search: 'Search transaction, category, recipient…', filters: ['All', 'Income', 'Expense'] },
    transport: { title: 'Transport fleet', subtitle: `${number(data.vehicles.length)} vehicles · routes, drivers and fuel`, search: 'Search vehicle, registration, driver, route…', filters: ['All'] },
    facilities: { title: 'Campus facilities', subtitle: `${number(data.rooms.length)} rooms · Blocks A and B`, search: 'Search room, issue, assigned class…', filters: ['All', 'Attention', 'Good'] },
    approvals: { title: 'Approval centre', subtitle: 'Review leave applications and record decisions', search: 'Search employee, application ID…', filters: ['All', 'Pending', 'Approved', 'Rejected'] },
  };
  const config = configs[page];
  const navAdd = page === 'students' ? onAdd : () => onToast('This workflow is available in demo mode');
  const colHeaders = {
    students: ['Student', 'Admission no.', 'Class', 'Guardian', 'Attendance', 'Fees due'],
    employees: ['Employee', 'Employee ID', 'Department', 'Designation', 'Phone', 'Monthly salary'],
    finance: ['Transaction', 'Date', 'Category', 'Recipient / vendor', 'Status', 'Amount'],
    transport: ['Vehicle', 'Registration', 'Driver', 'Route', 'Capacity', 'Monthly fuel'],
    facilities: ['Room', 'Block / floor', 'Type', 'Assigned to', 'Condition', 'Issue'],
    approvals: ['Applicant', 'Request ID', 'Leave type', 'Dates', 'Duration', 'Status'],
  }[page];

  const rowCells = (row) => {
    if (page === 'students') return [<><div className="table-person-avatar">{row.name[0]}</div><span className="table-person"><b>{row.name}</b><small>{row.gender} · {row.phone}</small></span></>, row.id, `Class ${row.className} · ${row.section}`, row.guardian, <span className={`attendance-tag ${row.attendance >= 85 ? 'good' : 'watch'}`}>{row.attendance}%</span>, money(Math.max(0, row.feeTotal - row.feePaid))];
    if (page === 'employees') return [<><div className="table-person-avatar">{row.name[0]}</div><span className="table-person"><b>{row.name}</b><small>{row.type}</small></span></>, row.id, row.department, row.designation, row.phone, money(row.salary)];
    if (page === 'finance') return [<span className="table-person"><b>{row.description}</b><small>{row.id} · {row.method}</small></span>, row.date, row.category, row.vendor, <span className={`status-tag ${row.status.toLowerCase()}`}>{row.status}</span>, <span className={row.type === 'Income' ? 'amount-income' : 'amount-expense'}>{row.type === 'Income' ? '+' : '−'}{money(row.amount)}</span>];
    if (page === 'transport') return [<span className="table-person"><b>{row.id} <span className="route-status">{row.status}</span></b><small>{row.type} · {row.students} students</small></span>, row.registration, row.driver, row.route, `${row.students} / ${row.capacity}`, money(row.fuelMonth)];
    if (page === 'facilities') return [<b>{row.id}</b>, `${row.block} · Floor ${row.floor}`, row.type, row.assigned, <span className={`status-tag ${row.condition === 'Good' ? 'cleared' : 'pending'}`}>{row.condition}</span>, row.issue];
    return [<span className="table-person"><b>{row.employee}</b><small>{row.employeeId}</small></span>, row.id, `${row.category} leave`, `${row.start}`, `${row.days} day${row.days > 1 ? 's' : ''}`, <span className={`status-tag ${row.status.toLowerCase()}`}>{row.status}</span>];
  };

  return <>
    <div className="page-heading"><div><div className="eyebrow">SCHOOL COMMAND <span>·</span> RECORDS</div><h1>{config.title}</h1><p>{config.subtitle}</p></div><div className="heading-actions">{page === 'students' && <button className="button button-primary" onClick={navAdd}><Plus size={16} /> Add student</button>}{page === 'approvals' && <button className="button button-primary" onClick={onAddLeave}><Plus size={16} /> Apply for leave</button>}{page === 'finance' && <><div className="finance-total"><span>Net expenses</span><b>{money(data.transactions.filter((item) => item.type === 'Expense' && ['Approved', 'Cleared'].includes(item.status)).reduce((sum, item) => sum + item.amount, 0))}</b></div><button className="button button-primary" onClick={onAddTransaction}><Plus size={16} /> Add transaction</button></>}</div></div>
    <section className="panel directory-panel"><div className="table-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPageNumber(1); }} placeholder={config.search} aria-label="Search records" /><kbd>⌘ K</kbd></div><div className="toolbar-actions"><label className="filter-select"><SlidersHorizontal size={15} /><select value={filter} onChange={(event) => { setFilter(event.target.value); setPageNumber(1); }}>{config.filters.map((option) => <option key={option} value={option}>{option === 'All' ? 'All records' : page === 'students' ? `Class ${option}` : option}</option>)}</select><ChevronDown size={14} /></label><button className="icon-button export-button" title="Export current records" onClick={() => exportCsv(shown, `${page}-demo.csv`, onToast)}><Download size={17} /></button></div></div>
      <div className="table-scroll"><table><thead><tr>{colHeaders.map((header) => <th key={header}>{header}</th>)}<th aria-label="Actions" /></tr></thead><tbody>{shown.map((row) => <tr key={row.id} onClick={() => onRecord(row, page)}>{rowCells(row).map((cell, index) => <td key={`${row.id}-${index}`}>{cell}</td>)}<td className="row-action" onClick={(event) => event.stopPropagation()}>{page === 'approvals' && row.status === 'Pending' ? <div className="decision-actions"><button title="Approve leave" className="small-icon approve" onClick={() => onDecision(row, 'Approved')}><Check size={15} /></button><button title="Reject leave" className="small-icon reject" onClick={() => onDecision(row, 'Rejected')}><X size={15} /></button></div> : page === 'finance' && row.status !== 'Reversed' ? <button className="row-link" title="Reverse transaction" onClick={() => onReverse(row)}><Archive size={15} /></button> : page === 'students' ? <button className="row-link" title="Edit student" onClick={() => onEdit(row)}><MoreHorizontal size={17} /></button> : <ChevronRight size={15} className="muted-icon" />}</td></tr>)}</tbody></table>
      {shown.length === 0 && <div className="empty-state"><Search size={24} /><b>No records found</b><span>Try a different search or filter.</span></div>}</div>
      <div className="table-footer"><span>Showing <b>{count ? (pageNumber - 1) * pageSize + 1 : 0}–{Math.min(pageNumber * pageSize, count)}</b> of <b>{number(count)}</b> records</span><div className="pagination"><button aria-label="Previous page" disabled={pageNumber <= 1} onClick={() => setPageNumber(pageNumber - 1)}><ChevronLeft size={16} /></button><span>Page {pageNumber} of {pages}</span><button aria-label="Next page" disabled={pageNumber >= pages} onClick={() => setPageNumber(pageNumber + 1)}><ChevronRight size={16} /></button></div></div>
    </section>
    {page === 'finance' && <div className="table-note"><ShieldCheck size={15} /> Financial records are reversed, never deleted. New demo entries are immediately marked approved/cleared; supporting bills are not uploaded.</div>}
  </>;
}

function AttendancePage({ data, onMark, onToast }) {
  const [audience, setAudience] = useState('Students');
  const [classFilter, setClassFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const pageSize = 12;
  const source = audience === 'Students' ? data.students : data.employees;
  const normalized = query.trim().toLowerCase();
  const rows = source.filter((item) => {
    const classMatches = audience !== 'Students' || classFilter === 'All' || item.className === classFilter;
    const searchMatches = `${item.name} ${item.id} ${item.guardian || ''} ${item.className || ''} ${item.department || ''}`.toLowerCase().includes(normalized);
    return classMatches && searchMatches;
  });
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const shown = rows.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
  const dailyRate = (items) => items.length ? Math.round(items.filter((item) => item.todayStatus !== 'Absent').length / items.length * 100) : 0;
  const classRows = Array.from({ length: 12 }, (_, index) => {
    const students = data.students.filter((student) => Number(student.className) === index + 1);
    const present = students.filter((student) => student.todayStatus !== 'Absent').length;
    return { name: `Class ${index + 1}`, total: students.length, present, absent: students.length - present, rate: dailyRate(students) };
  });
  const exportRows = rows.map((item) => ({ id: item.id, name: item.name, group: item.className ? `Class ${item.className} · ${item.section}` : item.department, status: item.todayStatus }));
  const todayLabel = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date()).toUpperCase();
  return <>
    <div className="page-heading"><div><div className="eyebrow">SCHOOL COMMAND <span>·</span> DAILY REGISTER · {todayLabel}</div><h1>Attendance</h1><p>Review and update today's fictional attendance records.</p></div><div className="heading-actions"><button className="button button-secondary" onClick={() => exportCsv(exportRows, 'school-command-attendance.csv', onToast)}><Download size={16} /> Export report</button></div></div>
    <div className="stats-grid attendance-stats"><Metric label="Student present" value={`${dailyRate(data.students)}%`} note={`${number(data.students.length)} enrolled · daily register`} icon={GraduationCap} /><Metric label="Staff present" value={`${dailyRate(data.employees)}%`} note={`${data.employees.length} employees · daily register`} icon={Users} /><Metric label="On approved leave" value={number(data.leaves.filter((item) => item.status === 'Approved').length)} note="Approved applications" icon={CalendarCheck} /></div>
    <section className="panel attendance-panel"><div className="panel-heading"><div><h2>Daily register</h2><p>Mark attendance changes are saved in this browser and added to the audit log.</p></div><div className="attendance-controls"><select className="select-button" value={audience} onChange={(event) => { setAudience(event.target.value); setPageNumber(1); }} aria-label="Attendance audience"><option>Students</option><option>Employees</option></select>{audience === 'Students' && <select className="select-button" value={classFilter} onChange={(event) => { setClassFilter(event.target.value); setPageNumber(1); }} aria-label="Filter by class"><option value="All">All classes</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={String(index + 1)}>Class {index + 1}</option>)}</select>}</div></div>
      <div className="table-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPageNumber(1); }} placeholder="Search name or record ID…" aria-label="Search attendance register" /></div><span className="attendance-count">{number(rows.length)} records</span></div>
      <div className="table-scroll"><table><thead><tr><th>{audience === 'Students' ? 'Student' : 'Employee'}</th><th>Record ID</th><th>{audience === 'Students' ? 'Class & section' : 'Department'}</th><th>Attendance status</th></tr></thead><tbody>{shown.map((item) => <tr key={item.id}><td><span className="table-person"><b>{item.name}</b><small>{item.guardian || item.designation}</small></span></td><td>{item.id}</td><td>{item.className ? `Class ${item.className} · ${item.section}` : item.department}</td><td><select className={`attendance-status-select ${item.todayStatus.toLowerCase()}`} aria-label={`Attendance status for ${item.name}`} value={item.todayStatus} onChange={(event) => onMark(audience, item.id, event.target.value)}><option>Present</option><option>Absent</option><option>Late</option></select></td></tr>)}</tbody></table>{shown.length === 0 && <div className="empty-state"><Search size={24} /><b>No attendance records found</b><span>Adjust your search or class filter.</span></div>}</div>
      <div className="table-footer"><span>Showing <b>{rows.length ? (pageNumber - 1) * pageSize + 1 : 0}–{Math.min(pageNumber * pageSize, rows.length)}</b> of <b>{number(rows.length)}</b></span><div className="pagination"><button aria-label="Previous attendance page" disabled={pageNumber <= 1} onClick={() => setPageNumber(pageNumber - 1)}><ChevronLeft size={16} /></button><span>Page {pageNumber} of {pages}</span><button aria-label="Next attendance page" disabled={pageNumber >= pages} onClick={() => setPageNumber(pageNumber + 1)}><ChevronRight size={16} /></button></div></div>
    </section>
    {audience === 'Students' && <section className="panel attendance-panel"><div className="panel-heading"><div><h2>Class summary</h2><p>Counts recalculate as you mark the daily register.</p></div></div><div className="table-scroll"><table><thead><tr><th>Class</th><th>Enrolled</th><th>Present / late</th><th>Absent</th><th>Attendance</th><th>Rate</th></tr></thead><tbody>{classRows.map((item) => <tr key={item.name}><td><b>{item.name}</b></td><td>{item.total}</td><td>{item.present}</td><td>{item.absent}</td><td><span className="attendance-tag good">{item.rate}%</span></td><td><div className="progress-track"><i style={{ width: `${item.rate}%` }} /></div></td></tr>)}</tbody></table></div></section>}
  </>;
}

function DepartmentsPage({ data, onNavigate }) {
  const names = ['Administration', 'Academics', 'Science', 'Mathematics', 'English', 'Commerce', 'Computer Science', 'Sports', 'Transport', 'Accounts', 'HR', 'Maintenance', 'Security'];
  return <><div className="page-heading"><div><div className="eyebrow">SCHOOL COMMAND <span>·</span> ORGANISATION</div><h1>Departments</h1><p>School teams, allocations and operational ownership.</p></div></div><div className="department-grid">{names.map((name, index) => { const staff = data.employees.filter((employee) => employee.department === name); const budget = 180000 + index * 42500; const used = Math.round(budget * (0.53 + (index % 5) * 0.07)); return <button className="department-card" key={name} onClick={() => onNavigate(name === 'Transport' ? 'transport' : name === 'Accounts' ? 'finance' : 'employees')}><div className="department-top"><span className="department-symbol">{name[0]}</span><MoreHorizontal size={18} /></div><h3>{name}</h3><span>{staff.length} assigned staff</span><div className="budget-line"><span>Budget utilisation</span><b>{Math.round(used / budget * 100)}%</b></div><div className="progress-track"><i style={{ width: `${used / budget * 100}%` }} /></div><div className="budget-amounts"><span>Spent {money(used)}</span><span>Budget {money(budget)}</span></div></button>; })}</div></>;
}

function ReportsPage({ data, expenses, income, onToast }) {
  const download = () => exportCsv(data.transactions, 'school-command-transactions.csv', onToast);
  return <><div className="page-heading"><div><div className="eyebrow">SCHOOL COMMAND <span>·</span> INSIGHTS</div><h1>Reports & analytics</h1><p>Operational summaries linked to current demo records.</p></div><button className="button button-secondary" onClick={download}><Download size={16} /> Export transactions</button></div><div className="report-grid"><ReportCard title="Student strength" value={number(data.students.length)} note="2026–27 enrolment" icon={GraduationCap} /><ReportCard title="Fee collection" value={money(income)} note="November · cleared receipts" icon={Wallet} /><ReportCard title="Monthly expenses" value={money(expenses)} note="November · approved transactions" icon={ArrowUpRight} /><ReportCard title="Employee payroll" value={money(data.employees.reduce((sum, item) => sum + item.salary, 0))} note="Estimated monthly base salary" icon={Users} /><ReportCard title="Fleet fuel cost" value={money(data.vehicles.reduce((sum, item) => sum + item.fuelMonth, 0))} note="November · 28 vehicles" icon={Bus} /><ReportCard title="Rooms needing attention" value={`${data.rooms.filter((item) => item.condition === 'Attention').length}`} note="Open facilities issues" icon={Wrench} /></div><section className="panel report-period"><div><h2>Report period</h2><p>Choose a reporting window for export.</p></div><div className="period-actions">{['Today', 'This week', 'This month', 'Previous month', 'Quarter', 'Academic year'].map((period) => <button key={period} onClick={() => onToast(`${period} report period selected`)}>{period}</button>)}</div></section></>;
}

function InformationPage({ data, onToast, onAdd, onRecord }) {
  const [query, setQuery] = useState('');
  const rows = data.assets.filter((asset) => `${asset.id} ${asset.name} ${asset.category} ${asset.location} ${asset.vendor}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <><div className="page-heading"><div><div className="eyebrow">SCHOOL COMMAND <span>·</span> ASSET REGISTER</div><h1>Inventory & assets</h1><p>{number(data.assets.length)} fictional assets · linked to their assigned locations.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={16} /> Add asset</button></div><section className="panel directory-panel"><div className="table-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search asset ID, name, category…" aria-label="Search assets" /></div><button className="icon-button export-button" title="Export inventory" onClick={() => exportCsv(rows, 'school-command-inventory.csv', onToast)}><Download size={17} /></button></div><div className="table-scroll"><table><thead><tr>{['Asset ID', 'Asset', 'Category', 'Assigned location', 'Condition', 'Purchase price', ''].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((asset) => <tr key={asset.id} onClick={() => onRecord(asset, 'inventory')}><td>{asset.id}</td><td><b>{asset.name}</b></td><td>{asset.category}</td><td>{asset.location}</td><td><span className={`status-tag ${asset.condition === 'Good' ? 'cleared' : 'pending'}`}>{asset.condition}</span></td><td>{money(asset.price)}</td><td><ChevronRight size={15} className="muted-icon" /></td></tr>)}</tbody></table>{rows.length === 0 && <div className="empty-state"><Search size={24} /><b>No assets found</b><span>Try a different search.</span></div>}</div><div className="table-note"><Package size={15} /> Fictional demo inventory · saved in this browser only.</div></section></>;
}

function AssistantPage({ data, totalExpenses, pendingLeaves }) {
  const answers = [
    ['How many students are enrolled?', `${number(data.students.length)} students are enrolled for academic year 2026–27.`],
    ['What are this month’s expenses?', `Approved November expenses total ${money(totalExpenses)} across ${data.transactions.filter((item) => item.type === 'Expense').length} transactions.`],
    ['Which buses need maintenance?', `${data.vehicles.filter((vehicle) => vehicle.status === 'Service due').map((vehicle) => vehicle.id).join(' and ')} are marked service due in the demo fleet.`],
    ['Which leave applications are pending?', `${pendingLeaves} fictional leave applications are awaiting review.`],
    ['Which rooms need attention?', `${data.rooms.filter((room) => room.condition === 'Attention').map((room) => room.id).join(', ')} have open facilities alerts.`],
  ];
  const [response, setResponse] = useState('');
  return <><div className="page-heading"><div><div className="eyebrow">SCHOOL COMMAND <span>·</span> FUTURE INTEGRATION</div><h1>AI executive assistant</h1><p>Explore school data with a guided demo. No AI service is connected.</p></div><span className="demo-chip"><Sparkles size={14} /> DEMO INTERFACE</span></div><section className="assistant-shell"><div className="assistant-intro"><div className="assistant-icon"><Sparkles size={22} /></div><div><h2>Good morning, Glenn.</h2><p>Choose a question to see an answer drawn from the current demo records.</p></div></div><div className="prompt-list">{answers.map(([question, answer]) => <button key={question} onClick={() => setResponse(answer)}>{question}<ArrowUpRight size={15} /></button>)}</div>{response && <div className="assistant-answer"><span className="assistant-icon small"><Sparkles size={15} /></span><p>{response}</p></div>}<div className="assistant-notice"><ShieldCheck size={17} /><span><b>No AI provider configured.</b> This is a deterministic demo interface. Questions are not sent to an AI service.</span></div></section></>;
}

function SettingsPage({ settings, authConnected, onSave }) {
  const [principalPermissions, setPrincipalPermissions] = useState(settings.principalPermissions || []);
  const submit = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({ schoolName: form.get('schoolName'), appName: form.get('appName'), academicYear: form.get('academicYear'), director: form.get('director'), principal: form.get('principal'), principalPermissions: [...new Set(['overview', ...principalPermissions])] });
  };
  const permissionOptions = navigation.flatMap((group) => group.items).filter(([, key]) => !['settings', 'audit'].includes(key));
  return <><div className="page-heading"><div><div className="eyebrow">SCHOOL COMMAND <span>·</span> CONFIGURATION</div><h1>Users & settings</h1><p>School profile and deployment readiness.</p></div></div><div className="settings-layout"><form className="panel settings-panel" onSubmit={submit}><div className="panel-heading"><div><h2>School details</h2><p>Identity shown throughout the workspace</p></div></div><label>Official school name<input name="schoolName" required defaultValue={settings.schoolName} /></label><label>Application name<input name="appName" required defaultValue={settings.appName} /></label><label>Academic year<select name="academicYear" defaultValue={settings.academicYear}><option>2026-27</option><option>2025-26</option><option>2027-28</option></select></label><label>Director<input name="director" required defaultValue={settings.director} /></label><label>Principal<input name="principal" required defaultValue={settings.principal} /></label><fieldset className="permission-fieldset"><legend>Principal demo access</legend><p>Choose which modules Glenda can open. Overview stays enabled. This is a local UI demo, not server-side authorization.</p><div className="permission-grid">{permissionOptions.map(([label, key]) => <label className="permission-option" key={key}><input type="checkbox" name="principalPermissions" value={key} checked={key === 'overview' || principalPermissions.includes(key)} disabled={key === 'overview'} onChange={(event) => setPrincipalPermissions((current) => event.target.checked ? [...current, key] : current.filter((permission) => permission !== key))} />{label}</label>)}</div></fieldset><button className="button button-primary" type="submit"><Check size={15} /> Save settings</button></form><section className="panel readiness-panel"><div className="panel-heading"><div><h2>Deployment readiness</h2><p>Production services are not configured</p></div></div>{[['Authentication provider', authConnected ? 'Connected' : 'Not connected'], ['PostgreSQL database', 'Not connected'], ['Private document storage', 'Not connected'], ['AI service', 'Not connected'], ['Browser demo storage', 'Active']].map(([label, value]) => <div className="readiness-row" key={label}><span>{label}</span><b className={['Active', 'Connected'].includes(value) ? 'ready' : ''}><i />{value}</b></div>)}<p className="readiness-note">{authConnected ? 'Supabase Auth is connected; school records remain fictional and browser-local.' : 'Demo mode has no secure user accounts or role enforcement. Do not enter real student or employee information.'}</p></section></div></>;
}

function AuditPage({ rows }) {
  return <><div className="page-heading"><div><div className="eyebrow">SCHOOL COMMAND <span>·</span> ACTIVITY HISTORY</div><h1>Audit log</h1><p>Actions recorded during this browser demo session.</p></div></div><section className="panel directory-panel"><div className="table-scroll"><table><thead><tr><th>User</th><th>Action</th><th>Related record</th><th>Date & time</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><b>{row.user}</b></td><td>{row.action}</td><td>{row.record}</td><td>{row.time}</td></tr>)}</tbody></table>{rows.length === 0 && <div className="empty-state"><Activity size={23} /><b>No recorded actions yet</b><span>Leave decisions and financial reversals will appear here.</span></div>}</div><div className="table-note"><ShieldCheck size={15} /> Audit history is browser-local demo data and is not tamper-proof.</div></section></>;
}

function RecordModal({ record, onClose, onEdit, onFeePayment, onNavigate }) {
  const type = record.recordType;
  const details = [];
  let title = record.name || record.id;
  let eyebrow = type.toUpperCase();
  if (type === 'students') details.push(['Admission number', record.id], ['Class & section', `Class ${record.className} · ${record.section}`], ['Roll number', record.roll], ['Academic year', record.academicYear], ['Gender', record.gender], ['Guardian', record.guardian], ['Parent contact', record.phone], ['Address', record.address], ['Admission date', record.admissionDate], ['Attendance', `${record.attendance}%`], ['Fee structure', money(record.feeTotal)], ['Fees paid', money(record.feePaid)], ['Outstanding balance', money(Math.max(0, record.feeTotal - record.feePaid))]);
  if (type === 'employees') details.push(['Employee ID', record.id], ['Employment type', record.type], ['Designation', record.designation], ['Department', record.department], ['Subject', record.subject], ['Contact', record.phone], ['Joining date', record.joiningDate], ['Employment status', record.status], ['Attendance', `${record.attendance}%`], ['Basic salary', money(record.salaryStructure.basic)], ['Allowances', money(record.salaryStructure.allowances)], ['Deductions', money(record.salaryStructure.deductions)], ['Net monthly salary', money(record.salaryStructure.net)]);
  if (type === 'transport') details.push(['Registration', record.registration], ['Vehicle type', record.type], ['Assigned driver', record.driver], ['Driver employee ID', record.driverId], ['Route', record.route], ['Capacity', `${record.capacity} seats`], ['Assigned students', record.students], ['Status', record.status], ['Monthly fuel estimate', money(record.fuelMonth)], ['Insurance expiry', '30/04/2027 · demo record'], ['Next service', '18/11/2026 · demo record']);
  if (type === 'facilities' || type === 'room') { title = `Room ${record.id}`; details.push(['Block', record.block], ['Floor', record.floor], ['Room type', record.type], ['Assigned department / class', record.assigned], ['Current condition', record.condition], ['Open issue', record.issue], ['Maintenance history', record.condition === 'Attention' ? 'Issue logged · awaiting assignment' : 'No open maintenance issues']); }
  if (type === 'finance') { title = record.description; details.push(['Transaction ID', record.id], ['Date', record.date], ['Category', record.category], ['Description', record.description], ['Vendor / recipient', record.vendor], ['Amount', money(record.amount)], ['Payment method', record.method], ['Reference number', record.reference], ['Approval status', record.status], ['Supporting document', 'Demo record · no uploaded document']); }
  if (type === 'approvals') { title = record.employee; details.push(['Application ID', record.id], ['Employee ID', record.employeeId], ['Leave category', record.category], ['Start date', record.start], ['Duration', `${record.days} day(s)`], ['Reason', record.reason], ['Application date', record.applicationDate || 'Seeded demo record'], ['Approval status', record.status], ...(record.approver ? [['Approver', record.approver], ['Decision date', record.decisionDate], ['Comments', record.comments]] : [])); }
  if (type === 'inventory') { title = record.name; details.push(['Asset ID', record.id], ['Category', record.category], ['Purchase date', record.purchaseDate], ['Purchase price', money(record.price)], ['Vendor', record.vendor], ['Assigned location', record.location], ['Condition', record.condition], ['Warranty', record.warranty], ['Maintenance history', record.maintenance]); }
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="record-modal" role="dialog" aria-modal="true" aria-label={`${title} details`}>
        <div className="record-modal-head"><div className="record-avatar">{title[0]}</div><div><span className="eyebrow">{eyebrow} PROFILE</span><h2>{title}</h2><p>{record.id}</p></div><button className="icon-button" aria-label="Close record" onClick={onClose}><X size={19} /></button></div>
        <div className="record-tabs"><button className="selected">Overview</button><button onClick={() => onNavigate(type === 'students' ? 'attendance' : type === 'finance' ? 'reports' : type === 'transport' ? 'transport' : 'audit')}>Related activity</button><button onClick={() => window.print()}>Documents</button></div>
        <div className="record-detail-grid">{details.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
        {type === 'students' && <section className="employee-payroll"><div className="panel-heading"><div><h2>Payment history</h2><p>Receipts reconcile to fees paid: {money(record.feePaid)}</p></div><button className="text-link" onClick={() => onFeePayment(record)}>Record payment <Plus size={14} /></button></div><div className="compact-list">{(record.payments || []).map((payment) => <div className="compact-row" key={payment.id}><div className="compact-main"><b>{payment.id}</b><span>{payment.date} · {payment.method} · {payment.reference}</span></div><b>{money(payment.amount)}</b><span className="status-tag cleared">{payment.status}</span></div>)}{(!record.payments || record.payments.length === 0) && <div className="empty-state"><Wallet size={20} /><b>No payments recorded</b><span>Outstanding balance: {money(Math.max(0, record.feeTotal - record.feePaid))}</span></div>}</div></section>}
        {type === 'employees' && <section className="employee-payroll"><div className="panel-heading"><div><h2>Recent payroll</h2><p>Monthly salary payment records</p></div></div><div className="compact-list">{(record.payrollHistory || []).map((payment) => <div className="compact-row" key={payment.id}><div className="compact-main"><b>{payment.month}</b><span>{payment.paidOn} · {payment.reference}</span></div><b>{money(payment.amount)}</b><span className="status-tag cleared">{payment.status}</span></div>)}</div></section>}
        <div className="record-modal-footer"><span><i className="live-dot" /> Fictional demonstration record</span><div className="record-actions">{['students', 'inventory'].includes(type) && <button className="button button-primary" onClick={() => onEdit(record, type)}>Edit {type === 'students' ? 'student' : 'asset'} <ChevronRight size={15} /></button>}</div></div>
      </section>
    </div>
  );
}

function StudentForm({ initial, onClose, onSubmit }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="form-modal" onSubmit={onSubmit}><div className="form-modal-head"><div><span className="eyebrow">STUDENT RECORD</span><h2>{initial.id ? 'Edit student' : 'Add student'}</h2><p>Changes are stored in this browser's demo data.</p></div><button type="button" className="icon-button" aria-label="Close form" onClick={onClose}><X size={19} /></button></div><div className="form-grid"><label>Full name<input name="name" required defaultValue={initial.name || ''} placeholder="Student full name" /></label><label>Admission number<input value={initial.id || 'Assigned when saved'} disabled /></label><label>Class<select name="className" defaultValue={initial.className || '1'}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1}>{index + 1}</option>)}</select></label><label>Section<select name="section" defaultValue={initial.section || 'A'}>{['A', 'B', 'C', 'D'].map((section) => <option key={section}>{section}</option>)}</select></label><label>Gender<select name="gender" defaultValue={initial.gender || 'Female'}><option>Female</option><option>Male</option><option>Other</option></select></label><label>Parent / guardian<input name="guardian" required defaultValue={initial.guardian || ''} placeholder="Guardian name" /></label><label className="full-width">Parent contact<input name="phone" required pattern="[0-9+() -]{8,16}" defaultValue={initial.phone || ''} placeholder="Phone number" /></label></div><div className="form-footer"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary"><Check size={15} /> Save student</button></div></form></div>;
}

function StudentFeeForm({ student, onClose, onSubmit }) {
  const balance = Math.max(0, student.feeTotal - student.feePaid);
  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const submit = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      amount: Number(form.get('amount')),
      date: new Date(`${form.get('date')}T00:00:00`).toLocaleDateString('en-GB'),
      method: form.get('method'), reference: form.get('reference'),
    });
  };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="form-modal" onSubmit={submit}><div className="form-modal-head"><div><span className="eyebrow">STUDENT FEE RECEIPT</span><h2>{student.name}</h2><p>{student.id} · balance due {money(balance)}</p></div><button type="button" className="icon-button" aria-label="Close form" onClick={onClose}><X size={19} /></button></div><div className="form-grid"><label>Payment amount (₹)<input name="amount" type="number" min="1" max={balance} step="1" required disabled={balance === 0} defaultValue={balance || ''} /></label><label>Payment date<input name="date" type="date" required defaultValue={localDate} /></label><label>Payment method<select name="method"><option>UPI</option><option>Bank transfer</option><option>Cheque</option><option>Cash</option></select></label><label>Receipt reference<input name="reference" required maxLength="60" defaultValue={`FEE/${student.id}/${(student.payments || []).length + 1}`} /></label></div><div className="form-footer"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={balance === 0}><Check size={15} /> Record receipt</button></div></form></div>;
}

function AssetForm({ initial, onClose, onSubmit }) {
  const handleSubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      ...initial,
      name: form.get('name'), category: form.get('category'), purchaseDate: form.get('purchaseDate'),
      price: Number(form.get('price')), vendor: form.get('vendor'), location: form.get('location'),
      condition: form.get('condition'), warranty: form.get('warranty'), maintenance: form.get('maintenance'),
    });
  };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="form-modal" onSubmit={handleSubmit}><div className="form-modal-head"><div><span className="eyebrow">ASSET REGISTER</span><h2>{initial.id ? 'Edit asset' : 'Add asset'}</h2><p>Changes are stored in this browser's demo data.</p></div><button type="button" className="icon-button" aria-label="Close form" onClick={onClose}><X size={19} /></button></div><div className="form-grid"><label className="full-width">Asset name<input name="name" required defaultValue={initial.name || ''} /></label><label>Category<select name="category" defaultValue={initial.category || 'Computer'}>{['Computer', 'AV Equipment', 'Furniture', 'Laboratory', 'Sports', 'Electrical', 'Safety', 'Stationery', 'Other'].map((value) => <option key={value}>{value}</option>)}</select></label><label>Condition<select name="condition" defaultValue={initial.condition || 'Good'}>{['Good', 'Needs repair', 'Service required', 'Retired'].map((value) => <option key={value}>{value}</option>)}</select></label><label>Purchase date<input name="purchaseDate" required defaultValue={initial.purchaseDate || new Date().toLocaleDateString('en-GB')} /></label><label>Purchase price (₹)<input name="price" type="number" min="0" step="1" required defaultValue={initial.price || ''} /></label><label>Vendor<input name="vendor" required defaultValue={initial.vendor || ''} /></label><label>Assigned location<input name="location" required defaultValue={initial.location || ''} /></label><label>Warranty<input name="warranty" defaultValue={initial.warranty || '12 months'} /></label><label>Maintenance history<input name="maintenance" defaultValue={initial.maintenance || 'No open maintenance'} /></label></div><div className="form-footer"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary"><Check size={15} /> Save asset</button></div></form></div>;
}

function LeaveForm({ employees, onClose, onSubmit }) {
  const handleSubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const employeeId = form.get('employeeId');
    const employee = employees.find((item) => item.id === employeeId);
    const startDate = new Date(`${form.get('start')}T00:00:00`);
    onSubmit({
      employee: employee.name, employeeId, category: form.get('category'),
      start: startDate.toLocaleDateString('en-GB'), days: Number(form.get('days')), reason: form.get('reason'),
    });
  };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="form-modal" onSubmit={handleSubmit}><div className="form-modal-head"><div><span className="eyebrow">LEAVE MANAGEMENT</span><h2>New leave application</h2><p>Submitted applications are added to the pending approval queue.</p></div><button type="button" className="icon-button" aria-label="Close form" onClick={onClose}><X size={19} /></button></div><div className="form-grid"><label className="full-width">Employee<select name="employeeId" required defaultValue=""><option value="" disabled>Select employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.id}</option>)}</select></label><label>Leave category<select name="category"><option>Casual</option><option>Medical</option><option>Earned</option><option>Other</option></select></label><label>Start date<input name="start" type="date" required /></label><label>Number of days<input name="days" type="number" min="1" max="90" required defaultValue="1" /></label><label className="full-width">Reason<textarea name="reason" required rows="3" maxLength="500" /></label></div><div className="form-footer"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary"><Check size={15} /> Submit application</button></div></form></div>;
}

function TransactionForm({ onClose, onSubmit }) {
  const [type, setType] = useState('Expense');
  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const categories = type === 'Expense'
    ? ['Bus fuel', 'Electricity', 'Maintenance', 'Stationery', 'Furniture', 'Payroll', 'Vendor payment', 'Other']
    : ['Student fee collection', 'Transport fees', 'Donation', 'Other income'];
  const handleSubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      type, date: new Date(`${form.get('date')}T00:00:00`).toLocaleDateString('en-GB'),
      category: form.get('category'), description: form.get('description'), vendor: form.get('vendor'),
      amount: Number(form.get('amount')), method: form.get('method'), reference: form.get('reference'),
    });
  };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="form-modal" onSubmit={handleSubmit}><div className="form-modal-head"><div><span className="eyebrow">FINANCE & ACCOUNTS</span><h2>Record transaction</h2><p>Fictional demo entries update dashboard totals immediately.</p></div><button type="button" className="icon-button" aria-label="Close form" onClick={onClose}><X size={19} /></button></div><div className="form-grid"><label>Transaction type<select value={type} onChange={(event) => setType(event.target.value)}><option>Expense</option><option>Income</option></select></label><label>Category<select name="category" key={type}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label className="full-width">Description<input name="description" required maxLength="120" /></label><label>Vendor / recipient<input name="vendor" required /></label><label>Amount (₹)<input name="amount" type="number" min="1" step="1" required /></label><label>Date<input name="date" type="date" required defaultValue={localDate} /></label><label>Payment method<select name="method"><option>Bank transfer</option><option>UPI</option><option>Cheque</option><option>Cash</option></select></label><label className="full-width">Reference number<input name="reference" required maxLength="60" /></label></div><div className="form-footer"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary"><Check size={15} /> Record {type.toLowerCase()}</button></div></form></div>;
}

function Metric({ label, value, note, icon: Icon }) { return <div className="stat-card metric-card"><div className="stat-icon green"><Icon size={19} /></div><span className="stat-label">{label}</span><b className="stat-value">{value}</b><span className="stat-foot">{note}</span></div>; }
function ReportCard({ title, value, note, icon: Icon }) { return <div className="report-card"><div className="report-card-top"><span className="stat-icon green"><Icon size={18} /></span><MoreHorizontal size={18} /></div><span>{title}</span><b>{value}</b><small>{note}</small></div>; }

function exportCsv(rows, filename, onToast) {
  if (!rows.length) { onToast('No records to export'); return; }
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => `"${String(row[header] ?? '').replaceAll('"', '""')}"`).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
  onToast(`${rows.length} records exported`);
}

export default App;