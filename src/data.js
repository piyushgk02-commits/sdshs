const firstNames = ['Aarav', 'Ananya', 'Rohan', 'Priya', 'Ishaan', 'Diya', 'Arjun', 'Meera', 'Vivaan', 'Aadhya', 'Kabir', 'Saanvi', 'Reyansh', 'Ira', 'Aditya', 'Kavya', 'Dev', 'Ishita', 'Advait', 'Myra'];
const lastNames = ['Sharma', 'Singh', 'Kumar', 'Verma', 'Patel', 'Reddy', 'Gupta', 'Nair', 'Joshi', 'Iyer', 'Mehta', 'Das', 'Rao', 'Kapoor', 'Chauhan', 'Mishra'];
const departments = ['Administration', 'Academics', 'Science', 'Mathematics', 'English', 'Commerce', 'Computer Science', 'Sports', 'Transport', 'Accounts', 'HR', 'Maintenance', 'Security'];
const designations = ['Teacher', 'Senior Teacher', 'Coordinator', 'Office Assistant', 'Driver', 'Lab Assistant', 'Security Officer', 'Housekeeping'];
const classes = Array.from({ length: 12 }, (_, index) => String(index + 1));
const phone = (index) => `9${String(100000000 + ((index * 7919) % 899999999)).slice(0, 9)}`;

function nameFor(index) {
  return `${firstNames[(index * 7 + 3) % firstNames.length]} ${lastNames[(index * 11 + 2) % lastNames.length]}`;
}

function attendanceStatus(index) {
  if (index % 31 === 0) return 'Absent';
  if (index % 17 === 0) return 'Late';
  return 'Present';
}

function studentPayments(student) {
  if (student.feePaid <= 0) return [];
  const first = Math.floor(student.feePaid * 0.4);
  const second = Math.floor(student.feePaid * 0.35);
  const payments = [first, second, student.feePaid - first - second];
  return payments.map((amount, index) => ({
    id: `RCPT-${student.id}-${index + 1}`,
    date: ['15/07/2026', '18/09/2026', '25/10/2026'][index],
    amount, method: ['UPI', 'Bank transfer', 'Cash'][index],
    reference: `FEE/${student.id}/${index + 1}`, status: 'Cleared',
  }));
}

export function createStudents() {
  return Array.from({ length: 3248 }, (_, index) => {
    const number = index + 1;
    const grade = (index % 12) + 1;
    const student = {
      id: `SD-${String(number).padStart(4, '0')}`,
      name: nameFor(index),
      className: `${grade}`,
      section: ['A', 'B', 'C', 'D'][Math.floor(index / 12) % 4],
      roll: (Math.floor(index / 48) % 42) + 1,
      gender: index % 2 ? 'Female' : 'Male',
      academicYear: '2026-27',
      guardian: nameFor(index + 87),
      phone: phone(index),
      attendance: 72 + ((index * 13) % 29),
      todayStatus: attendanceStatus(index),
      feeTotal: 24000 + (grade * 800),
      feePaid: 9000 + ((index * 337) % (12000 + grade * 500)),
      address: `${12 + (index % 80)}, Savio Nagar, Bengaluru`,
      admissionDate: `${String((index % 27) + 1).padStart(2, '0')}/06/${2015 + (index % 10)}`,
    };
    return { ...student, payments: studentPayments(student) };
  });
}

function employmentDetails(employee, index) {
  const salary = employee.salary;
  const payments = [
    ['June 2026', '05/07/2026'], ['July 2026', '05/08/2026'], ['August 2026', '05/09/2026'],
    ['September 2026', '05/10/2026'], ['October 2026', '05/11/2026'],
  ];
  return {
    ...employee,
    joiningDate: `${String((index % 27) + 1).padStart(2, '0')}/06/${2010 + (index % 16)}`,
    attendance: 82 + ((index * 7) % 17),
    todayStatus: attendanceStatus(index + 5000),
    salaryStructure: {
      basic: Math.round(salary * 0.8), allowances: Math.round(salary * 0.25),
      deductions: Math.round(salary * 0.05), net: salary,
    },
    payrollHistory: payments.map(([month, paidOn], paymentIndex) => ({
      id: `PAY-${employee.id}-${paymentIndex + 1}`, month, paidOn, amount: salary,
      status: 'Paid', reference: `SAL/${employee.id}/${paymentIndex + 1}`,
    })),
  };
}

export function createEmployees() {
  const teaching = Array.from({ length: 285 }, (_, index) => employmentDetails({
    id: `T-${String(index + 1).padStart(3, '0')}`,
    name: nameFor(index + 3400),
    type: 'Teaching',
    designation: index % 5 === 0 ? 'Senior Teacher' : 'Teacher',
    department: departments[(index % 7) + 1],
    subject: ['Mathematics', 'English', 'Science', 'Computer Science', 'Commerce'][index % 5],
    phone: phone(index + 3300),
    salary: 32000 + ((index * 1700) % 28000),
    status: 'Active',
  }, index));
  const other = Array.from({ length: 194 }, (_, index) => employmentDetails({
    id: `S-${String(index + 1).padStart(3, '0')}`,
    name: nameFor(index + 3700),
    type: 'Other staff',
    designation: designations[(index % 6) + 2],
    department: departments[(index * 3) % departments.length],
    subject: '—',
    phone: phone(index + 4500),
    salary: 18000 + ((index * 1100) % 21000),
    status: 'Active',
  }, index + 285));
  return [...teaching, ...other];
}

export function createVehicles(employees = createEmployees()) {
  return Array.from({ length: 28 }, (_, index) => ({
    id: `D${index + 1}`,
    registration: `KA 05 AB ${String(1200 + index * 37)}`,
    type: index < 23 ? 'School bus' : 'Mini bus',
    driver: employees[285 + (index % 194)].name,
    driverId: `S-${String((index % 194) + 1).padStart(3, '0')}`,
    route: `Route ${String(index + 1).padStart(2, '0')} · ${['North', 'South', 'East', 'West'][index % 4]}`,
    capacity: index < 23 ? 42 : 24,
    students: 28 + ((index * 7) % 15),
    status: index === 7 || index === 19 ? 'Service due' : 'On route',
    fuelMonth: 11800 + index * 235,
  }));
}

export function createRooms() {
  const rooms = [];
  for (const block of ['A', 'B']) {
    for (let floor = 1; floor <= 4; floor += 1) {
      for (let room = 1; room <= 9; room += 1) {
        const id = `${block}-${floor}0${room}`;
        const issueMap = { 'A-102': 'Fan issue', 'A-205': 'Projector issue', 'B-103': 'Furniture issue', 'B-204': 'Electrical issue', 'B-305': 'Water issue' };
        rooms.push({
          id,
          block: `Block ${block}`,
          floor,
          type: room % 5 === 0 ? 'Laboratory' : 'Classroom',
          assigned: room % 5 === 0 ? 'Science' : `Class ${((floor + room) % 12) + 1}`,
          condition: issueMap[id] ? 'Attention' : 'Good',
          issue: issueMap[id] || '—',
        });
      }
    }
  }
  return rooms;
}

export function createLeaves() {
  return Array.from({ length: 12 }, (_, index) => ({
    id: `LV-${String(index + 1).padStart(3, '0')}`,
    employeeId: `T-${String(index + 1).padStart(3, '0')}`,
    employee: nameFor(index + 3400),
    category: ['Casual', 'Medical', 'Earned'][index % 3],
    start: `0${(index % 8) + 1}/11/2026`,
    days: (index % 3) + 1,
    reason: ['Family commitment', 'Medical appointment', 'Personal work'][index % 3],
    status: 'Pending',
  }));
}

export function createTransactions() {
  const expenses = [
    ['Bus fuel', 'Savio Fuels', 82400], ['Electricity', 'BESCOM', 56800],
    ['Maintenance', 'Campus Works Co.', 72000], ['Stationery', 'Paper & Pen Supply', 43220],
    ['Furniture', 'Classic School Furnishers', 64000],
  ].map(([category, vendor, amount], index) => ({
    id: `EX-2026-${String(index + 1).padStart(3, '0')}`,
    date: `0${index + 2}/11/2026`, category, description: `${category} · November operations`, vendor,
    amount, method: ['Bank transfer', 'UPI', 'Cheque'][index % 3], reference: `SDH/26/${420 + index}`,
    type: 'Expense', status: 'Approved',
  }));
  const incomeAmounts = [250000, 225000, 210000, 190000, 185000, 190000];
  const income = incomeAmounts.map((amount, index) => ({
    id: `FE-2026-${String(index + 1).padStart(3, '0')}`,
    date: `${String(index + 5).padStart(2, '0')}/11/2026`, category: 'Fee collection',
    description: `Student fee receipts · batch ${index + 1}`, vendor: 'Student accounts', amount,
    method: ['UPI', 'Bank transfer', 'Cash'][index % 3], reference: `FEE/NOV/${index + 1}`,
    type: 'Income', status: 'Cleared',
  }));
  return [...expenses, ...income];
}

export function createAssets() {
  return [
    ['AST-0142', 'Epson classroom projector', 'AV Equipment', '12/08/2024', 48500, 'Classroom AV Supplies', 'A-205', 'Service required'],
    ['AST-0141', 'Dell Latitude laptop', 'Computer', '03/02/2025', 68400, 'Savio Technology', 'Admin Office', 'Good'],
    ['AST-0138', 'Science lab microscope', 'Laboratory', '21/06/2023', 22900, 'Bengaluru Lab Works', 'A-405', 'Good'],
    ['AST-0127', 'Student desk set', 'Furniture', '14/01/2022', 8200, 'Classic School Furnishers', 'B-103', 'Needs repair'],
    ['AST-0119', 'HP desktop workstation', 'Computer', '19/11/2024', 56200, 'Savio Technology', 'Accounts', 'Good'],
    ['AST-0112', 'Sports equipment kit', 'Sports', '07/07/2025', 15700, 'Playfield Sports', 'Sports Store', 'Good'],
    ['AST-0108', 'Interactive display panel', 'AV Equipment', '10/04/2025', 118000, 'Classroom AV Supplies', 'A-201', 'Good'],
    ['AST-0103', 'Library shelving unit', 'Furniture', '29/09/2022', 32800, 'Classic School Furnishers', 'Library', 'Good'],
    ['AST-0097', 'Chemistry safety cabinet', 'Laboratory', '17/03/2024', 41200, 'Bengaluru Lab Works', 'B-304', 'Good'],
    ['AST-0092', 'Network switch 24-port', 'Electrical', '02/12/2024', 18400, 'Savio Technology', 'Server Room', 'Good'],
    ['AST-0086', 'Student chair set', 'Furniture', '20/05/2023', 12600, 'Classic School Furnishers', 'A-103', 'Good'],
    ['AST-0079', 'First-aid and safety kit', 'Safety', '01/08/2025', 5400, 'Campus Safety Supplies', 'Nurse Room', 'Good'],
  ].map(([id, name, category, purchaseDate, price, vendor, location, condition]) => ({
    id, name, category, purchaseDate, price, vendor, location, condition,
    warranty: '12 months · demo record', maintenance: condition === 'Good' ? 'No open maintenance' : 'Inspection required',
  }));
}

export function loadDemoState() {
  const employees = createEmployees();
  const base = {
    students: createStudents(), employees, vehicles: createVehicles(employees),
    rooms: createRooms(), leaves: createLeaves(), transactions: createTransactions(), assets: createAssets(), audit: [],
    settings: {
      schoolName: "St Dominic Savio's High School", appName: 'SCHOOL COMMAND', academicYear: '2026-27', director: 'Glenn', principal: 'Glenda',
      principalPermissions: ['overview', 'students', 'employees', 'attendance', 'approvals', 'finance', 'transport', 'facilities', 'inventory', 'departments', 'reports', 'assistant'],
    },
  };
  try {
    const saved = JSON.parse(localStorage.getItem('school-command-demo') || '{}');
    const state = { ...base, ...saved };
    state.settings = { ...base.settings, ...(saved.settings || {}) };
    state.employees = (state.employees || []).map((employee, index) => {
      const defaults = employmentDetails(employee, index);
      return {
        ...defaults,
        ...employee,
        joiningDate: employee.joiningDate || defaults.joiningDate,
        attendance: employee.attendance ?? defaults.attendance,
        salaryStructure: employee.salaryStructure || defaults.salaryStructure,
        payrollHistory: employee.payrollHistory || defaults.payrollHistory,
      };
    });
    state.students = (state.students || []).map((student, index) => ({
      ...student,
      todayStatus: student.todayStatus || base.students[index]?.todayStatus || 'Present',
      payments: student.payments || studentPayments(student),
    }));
    return state;
  } catch {
    return base;
  }
}

export const money = (value) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
}).format(value);

export const number = (value) => new Intl.NumberFormat('en-IN').format(value);