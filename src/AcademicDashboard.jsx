import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CalendarCheck, LogOut, Search, ShieldCheck, Users, Wallet } from 'lucide-react';

const money = (value) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
}).format(value || 0);

const date = (value) => value
  ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`))
  : '—';

async function fetchAllAttendance(supabase) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('academic_attendance')
      .select('student_id, attendance_date, status')
      .order('attendance_date', { ascending: false })
      .order('id')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

export default function AcademicDashboard({ session, supabase, onLogout }) {
  const [students, setStudents] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [fees, setFees] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [query, setQuery] = useState('');
  const [sectionFilter, setSectionFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const coordinator = session.role === 'Class Coordinator';

  const loadDashboard = async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    setStudents([]);
    setAttendance([]);
    setFees([]);
    setContacts([]);
    setPayments([]);
    const requests = [
      supabase.from('academic_students')
        .select('id, admission_number, full_name, class_number, section, father_name, mother_name, admission_date, annual_fee')
        .order('admission_number'),
      supabase.rpc('get_academic_fee_summaries'),
    ];
    if (coordinator) {
      requests.push(
        supabase.from('student_guardian_contacts').select('student_id, phone, email'),
        supabase.from('academic_fee_payments')
          .select('student_id, paid_on, amount, method, reference')
          .order('paid_on', { ascending: false }),
      );
    }

    try {
      const results = await Promise.all(requests);
      const failed = results.find((result) => result.error);
      if (failed) throw failed.error;
      const attendanceRows = await fetchAllAttendance(supabase);
      if (currentRequest !== requestId.current) return;
      setStudents(results[0].data || []);
      setAttendance(attendanceRows);
      setFees(results[1].data || []);
      setContacts(coordinator ? results[2].data || [] : []);
      setPayments(coordinator ? results[3].data || [] : []);
    } catch (loadError) {
      if (currentRequest !== requestId.current) return;
      setError(loadError.message || 'Unable to load your assigned student records.');
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
    return () => { requestId.current += 1; };
  }, [session.id, session.role, session.assignedClass, session.assignedSection]);

  const visibleStudents = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return students.filter((student) => {
      const sectionMatches = !coordinator || sectionFilter === 'All' || student.section === sectionFilter;
      const searchMatches = !normalized || [
        student.full_name,
        student.admission_number,
        student.father_name,
        student.mother_name,
        student.section,
      ].some((value) => String(value || '').toLocaleLowerCase().includes(normalized));
      return sectionMatches && searchMatches;
    });
  }, [students, query, sectionFilter, coordinator]);

  const attendanceByStudent = useMemo(() => {
    const summary = new Map();
    for (const record of attendance) {
      const row = summary.get(record.student_id) || { present: 0, absent: 0, late: 0, records: [] };
      if (record.status === 'Absent') row.absent += 1;
      else if (record.status === 'Late') row.late += 1;
      else row.present += 1;
      row.records.push(record);
      summary.set(record.student_id, row);
    }
    return summary;
  }, [attendance]);

  const feesByStudent = useMemo(
    () => new Map(fees.map((row) => [row.student_id, {
      total: Number(row.total_fees),
      paid: Number(row.fees_paid),
      balance: Number(row.balance),
    }])),
    [fees],
  );
  const contactsByStudent = useMemo(() => new Map(contacts.map((row) => [row.student_id, row])), [contacts]);
  const paymentsByStudent = useMemo(() => {
    const grouped = new Map();
    for (const payment of payments) {
      const rows = grouped.get(payment.student_id) || [];
      rows.push(payment);
      grouped.set(payment.student_id, rows);
    }
    return grouped;
  }, [payments]);

  const totalPresent = attendance.filter((record) => record.status !== 'Absent').length;
  const totalAbsent = attendance.filter((record) => record.status === 'Absent').length;
  const attendanceRate = attendance.length ? Math.round((totalPresent / attendance.length) * 100) : 0;
  const feesTotal = fees.reduce((sum, row) => sum + Number(row.total_fees), 0);
  const feesPaid = fees.reduce((sum, row) => sum + Number(row.fees_paid), 0);
  const sectionACount = students.filter((student) => student.section === 'A').length;
  const sectionBCount = students.filter((student) => student.section === 'B').length;

  return (
    <main className="academic-shell">
      <header className="academic-header">
        <div className="academic-brand">
          <div className="brand-mark"><span>SD</span><i /></div>
          <div><strong>SCHOOL<span>COMMAND</span></strong><small>ST DOMINIC SAVIO'S HIGH SCHOOL</small></div>
        </div>
        <div className="academic-account">
          <div><b>{session.name}</b><span>{session.role} · {session.email}</span></div>
          <button className="button button-secondary" onClick={onLogout}><LogOut size={15} /> Sign out</button>
        </div>
      </header>

      <section className="academic-content">
        <div className="academic-heading">
          <div className="eyebrow"><ShieldCheck size={14} /> SECURE ACADEMIC ACCESS</div>
          <h1>{coordinator ? `Class ${session.assignedClass} Coordinator` : `Class ${session.assignedClass}-${session.assignedSection} Teacher`}</h1>
          <p>Read-only student, attendance, and fee records for your assigned {coordinator ? 'class' : 'section'}.</p>
        </div>

        {error && <div className="academic-error" role="alert">
          <b>Student records could not be loaded.</b><span>{error}</span>
          <button className="button button-secondary" onClick={() => void loadDashboard()}>Try again</button>
        </div>}

        <div className="academic-metrics">
          <AcademicMetric icon={Users} label="Total students" value={students.length} detail={coordinator ? `${sectionACount} Section A · ${sectionBCount} Section B` : `Class ${session.assignedClass} · Section ${session.assignedSection}`} />
          {coordinator && <AcademicMetric icon={BookOpen} label="Section A / B" value={`${sectionACount} / ${sectionBCount}`} detail="Students in your assigned class" />}
          <AcademicMetric icon={CalendarCheck} label="Attendance" value={`${attendanceRate}%`} detail={`${totalPresent.toLocaleString('en-IN')} present · ${totalAbsent.toLocaleString('en-IN')} absent days`} />
          <AcademicMetric icon={Wallet} label="Fees submitted" value={money(feesPaid)} detail={`${money(Math.max(0, feesTotal - feesPaid))} remaining of ${money(feesTotal)}`} />
        </div>

        <section className="panel academic-directory">
          <div className="panel-heading">
            <div><h2>Student directory</h2><p>Student details are fetched from the secured school database.</p></div>
            <span className="read-only-badge"><ShieldCheck size={13} /> View only</span>
          </div>
          <div className="table-toolbar">
            <label className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search student, admission number, parent…" aria-label="Search assigned students" /></label>
            {coordinator && <select className="select-button" value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)} aria-label="Filter by section">
              <option value="All">Both sections</option><option value="A">Section A</option><option value="B">Section B</option>
            </select>}
            <span className="attendance-count">{visibleStudents.length} students</span>
          </div>

          <div className="table-scroll">
            <table className="academic-student-table">
              <thead><tr>
                <th>Student</th><th>Admission no.</th>{coordinator && <th>Section</th>}
                <th>Father</th><th>Mother</th>{coordinator && <th>Parent contact</th>}
                <th>Admitted</th><th>Present days</th><th>Absent days</th><th>Attendance</th><th>Attendance history</th>
                <th>Total fees</th><th>Submitted</th><th>Balance</th>{coordinator && <th>Payment history</th>}
              </tr></thead>
              <tbody>
                {visibleStudents.map((student) => {
                  const attendanceRow = attendanceByStudent.get(student.id) || { present: 0, absent: 0, late: 0 };
                  const attended = attendanceRow.present + attendanceRow.late;
                  const attendanceDays = attended + attendanceRow.absent;
                  const attendancePercent = attendanceDays ? Math.round((attended / attendanceDays) * 100) : 0;
                  const feeRow = feesByStudent.get(student.id) || { total: Number(student.annual_fee), paid: 0, balance: Number(student.annual_fee) };
                  const contact = contactsByStudent.get(student.id);
                  const studentPayments = paymentsByStudent.get(student.id) || [];
                  return <tr key={student.id}>
                    <td><span className="table-person"><b>{student.full_name}</b><small>Class {student.class_number} · Section {student.section}</small></span></td>
                    <td>{student.admission_number}</td>
                    {coordinator && <td>Section {student.section}</td>}
                    <td>{student.father_name}</td><td>{student.mother_name}</td>
                    {coordinator && <td>{contact ? <span className="table-person"><b>{contact.phone}</b><small>{contact.email}</small></span> : '—'}</td>}
                    <td>{date(student.admission_date)}</td>
                    <td>{attended}</td><td>{attendanceRow.absent}</td>
                    <td><span className={`attendance-tag ${attendancePercent < 75 ? 'attention' : 'good'}`}>{attendancePercent}%</span></td>
                    <td><details className="academic-payment-details">
                      <summary>{attendanceRow.records.length} days</summary>
                      <ul>{attendanceRow.records.map((record) => <li key={`${record.attendance_date}-${record.status}`}>
                        <b>{record.status}</b><span>{date(record.attendance_date)}</span>
                      </li>)}</ul>
                    </details></td>
                    <td>{money(feeRow.total)}</td><td>{money(feeRow.paid)}</td><td>{money(feeRow.balance)}</td>
                    {coordinator && <td><details className="academic-payment-details">
                      <summary>{studentPayments.length} payments</summary>
                      <ul>{studentPayments.map((payment) => <li key={payment.reference}>
                        <b>{money(Number(payment.amount))}</b><span>{date(payment.paid_on)} · {payment.method}</span><small>{payment.reference}</small>
                      </li>)}</ul>
                    </details></td>}
                  </tr>;
                })}
              </tbody>
            </table>
            {!loading && visibleStudents.length === 0 && !error && <div className="empty-state"><Search size={24} /><b>No students found</b><span>Adjust your search or section filter.</span></div>}
            {loading && <div className="academic-loading" role="status">Loading your authorized student records…</div>}
          </div>
          <div className="academic-table-note"><ShieldCheck size={14} /> Student records, attendance, fees, and parent contact access are restricted by database policies.</div>
        </section>
      </section>
    </main>
  );
}

function AcademicMetric({ icon: Icon, label, value, detail }) {
  return <article className="stat-card academic-metric">
    <div className="stat-icon green"><Icon size={19} /></div>
    <span className="stat-label">{label}</span><b className="stat-value">{value}</b><span className="stat-foot">{detail}</span>
  </article>;
}
