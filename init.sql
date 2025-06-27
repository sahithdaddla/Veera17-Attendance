CREATE TABLE attendance (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(7) NOT NULL,
    date DATE NOT NULL,
    clock_in TIME,
    clock_out TIME,
    duration VARCHAR(10),
    status VARCHAR(20) NOT NULL CHECK (status IN ('present', 'late', 'absent')),
    UNIQUE(employee_id, date)
);
