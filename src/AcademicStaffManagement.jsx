import { useEffect, useMemo, useState } from 'react';
import { Check, MailPlus, RefreshCw, ShieldCheck, UserRoundCog, UserRoundX } from 'lucide-react';

const roles = ['Class Coordinator', 'Class Teacher'];

export default function AcademicStaffManagement({ supabase }) {
  const [staff, setStaff] = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(roles[0]);
  const [classNumber, setClassNumber] = useState('1');
  const [section, setSection] = useState('A');
  const [inviteNew, setInviteNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const accounts = useMemo(() => [
    ...staff.map((profile) => ({ ...profile, assigned: true })),
    ...unassigned.map((account) => ({ ...account, assigned: false })),
  ], [staff, unassigned]);

  const loadAccounts = async () => {
    setLoading(true);
    setError('');
    const [staffResult, unassignedResult] = await Promise.all([
      supabase.rpc('list_academic_staff'),
      supabase.rpc('list_unassigned_staff_accounts'),
    ]);
    if (staffResult.error || unassignedResult.error) {
      setError(staffResult.error?.message || unassignedResult.error?.message || 'Unable to load staff accounts.');
      setLoading(false);
      return;
    }
    setStaff(staffResult.data || []);
    setUnassigned(unassignedResult.data || []);
    setLoading(false);
  };

  useEffect(() => {
    void loadAccounts();
  }, []);

  const selectAccount = (userId) => {
    setAccountId(userId);
    const selected = accounts.find((account) => account.user_id === userId);
    if (!selected) return;
    setFullName(selected.full_name || '');
    setEmail(selected.email || '');
    if (selected.assigned) {
      setRole(selected.role);
      setClassNumber(String(selected.assigned_class));
      setSection(selected.assigned_section || 'A');
    }
  };

  const submitAssignment = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const assignment = {
      target_full_name: fullName.trim(),
      target_role: role,
      target_class: Number(classNumber),
      target_section: role === 'Class Teacher' ? section : null,
    };

    try {
      if (inviteNew) {
        const { data: result, error: inviteError } = await supabase.functions.invoke('manage-academic-staff', {
          body: { action: 'invite', email: email.trim(), ...assignment },
        });
        if (inviteError) {
          const response = inviteError.context instanceof Response ? await inviteError.context.json() : null;
          throw new Error(response?.error || inviteError.message);
        }
        if (result?.error) throw new Error(result.error);
        setNotice(`Invitation sent to ${email.trim()}. The account is assigned and remains limited to its class or section.`);
      } else {
        if (!accountId) throw new Error('Choose an existing Auth account first.');
        const { error: assignmentError } = await supabase.rpc('assign_academic_staff', {
          target_user_id: accountId,
          ...assignment,
        });
        if (assignmentError) throw assignmentError;
        setNotice('Academic staff assignment saved.');
      }
      setAccountId('');
      setFullName('');
      setEmail('');
      await loadAccounts();
    } catch (assignmentError) {
      setError(assignmentError.message || 'Unable to save this staff assignment.');
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (profile) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const nextStatus = profile.status === 'active' ? 'inactive' : 'active';
      const { error: statusError } = await supabase.rpc('set_academic_staff_status', {
        target_user_id: profile.user_id,
        target_status: nextStatus,
      });
      if (statusError) setError(statusError.message);
      else setNotice(`${profile.full_name}'s account is ${nextStatus}.`);
    } catch (statusError) {
      setError(statusError.message || 'Unable to change this staff account status.');
    } finally {
      await loadAccounts();
      setBusy(false);
    }
  };

  const activeCoordinators = staff.filter((profile) => profile.status === 'active' && profile.role === 'Class Coordinator').length;
  const activeTeachers = staff.filter((profile) => profile.status === 'active' && profile.role === 'Class Teacher').length;

  return <section className="panel academic-staff-panel">
    <div className="panel-heading"><div><h2>Academic staff access</h2><p>Invite, assign, and deactivate read-only academic accounts.</p></div><ShieldCheck size={19} /></div>
    <div className="staff-coverage">
      <div><b>{activeCoordinators} / 12</b><span>active class coordinators</span></div>
      <div><b>{activeTeachers} / 24</b><span>active class teachers</span></div>
    </div>
    {error && <p className="academic-management-error" role="alert">{error}</p>}
    {notice && <p className="academic-management-notice" role="status">{notice}</p>}

    <form className="staff-assignment-form" onSubmit={submitAssignment}>
      <div className="panel-heading"><div><h3>{inviteNew ? 'Invite a new account' : 'Assign an existing account'}</h3><p>Server-side checks prevent self-assignment and duplicate active assignments.</p></div>
        <label className="staff-invite-toggle"><input type="checkbox" checked={inviteNew} onChange={(event) => { setInviteNew(event.target.checked); setAccountId(''); setFullName(''); setEmail(''); }} /> Invite by email</label>
      </div>
      {inviteNew ? <div className="form-grid">
        <label>Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required maxLength={120} /></label>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
      </div> : <div className="form-grid">
        <label className="full-width">Auth account<select required value={accountId} onChange={(event) => selectAccount(event.target.value)}>
          <option value="">Select an unassigned or academic staff account</option>
          {accounts.map((account) => <option key={account.user_id} value={account.user_id}>
            {account.email}{account.assigned ? ` · ${account.role} · Class ${account.assigned_class}${account.assigned_section ? `-${account.assigned_section}` : ''}` : ' · Unassigned'}
          </option>)}
        </select></label>
        <label>Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} required maxLength={120} /></label>
        <label>Email<input value={email} readOnly /></label>
      </div>}
      <div className="form-grid staff-role-fields">
        <label>Role<select value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Class<select value={classNumber} onChange={(event) => setClassNumber(event.target.value)}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>Class {index + 1}</option>)}</select></label>
        {role === 'Class Teacher' && <label>Section<select value={section} onChange={(event) => setSection(event.target.value)}><option>A</option><option>B</option></select></label>}
      </div>
      <button className="button button-primary" disabled={busy || loading || (!inviteNew && accounts.length === 0)}>
        {inviteNew ? <MailPlus size={15} /> : <Check size={15} />}
        {busy ? 'Saving…' : inviteNew ? 'Invite and assign' : 'Save assignment'}
      </button>
    </form>

    <div className="academic-staff-list">
      <div className="panel-heading"><div><h3>Current assignments</h3><p>Only active assignments may occupy a class or section.</p></div>
        <button className="icon-button" aria-label="Refresh academic staff" onClick={() => void loadAccounts()} disabled={loading}><RefreshCw size={16} /></button>
      </div>
      {loading ? <div className="academic-loading" role="status">Loading staff assignments…</div> : staff.length === 0
        ? <div className="empty-state"><UserRoundCog size={23} /><b>No academic staff assigned</b><span>Invite or assign staff accounts above.</span></div>
        : <div className="table-scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Assignment</th><th>Status</th><th>Access</th></tr></thead><tbody>
          {staff.map((profile) => <tr key={profile.user_id}>
            <td><b>{profile.full_name}</b></td><td>{profile.email}</td><td>{profile.role}</td>
            <td>Class {profile.assigned_class}{profile.assigned_section ? ` · Section ${profile.assigned_section}` : ''}</td>
            <td><span className={`staff-status ${profile.status}`}>{profile.status}</span></td>
            <td><div className="staff-row-actions">
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => { selectAccount(profile.user_id); setInviteNew(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit assignment</button>
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => void toggleStatus(profile)}>{profile.status === 'active' ? <UserRoundX size={14} /> : <Check size={14} />}{profile.status === 'active' ? 'Deactivate' : 'Activate'}</button>
            </div></td>
          </tr>)}
        </tbody></table></div>}
    </div>
  </section>;
}
