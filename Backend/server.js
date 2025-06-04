const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// CORS configuration to allow multiple origins
const allowedOrigins = [
    'http://localhost:3000',
];

app.use(cors());

app.use(express.json());

// PostgreSQL connection configuration
const pool = new Pool({
    user:'postgres',
    host:'localhost',
    database:'attendance_system',
    password:'Veera@0134',
    port:5432,
});

// Connect to PostgreSQL
pool.connect((err) => {
    if (err) {
        console.error('Error connecting to PostgreSQL:', err.stack);
        return;
    }
    console.log('Connected to PostgreSQL database');
});

// Create attendance table if it doesn't exist
const createTableQuery = `
    DROP TABLE IF EXISTS attendance;
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
`;

pool.query(createTableQuery, (err, res) => {
    if (err) {
        console.error('Error creating table:', err.stack);
    } else {
        console.log('Attendance table ready');
    }
});

// GET all attendance records, optionally filtered by employee_id
app.get('/api/attendance', async (req, res) => {
    try {
        const { employee_id } = req.query;
        let query = 'SELECT * FROM attendance ORDER BY date DESC';
        let values = [];
        if (employee_id) {
            query = 'SELECT * FROM attendance WHERE employee_id = $1 ORDER BY date DESC';
            values = [employee_id];
        }
        const result = await pool.query(query, values);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching attendance records:', err.stack);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST a new attendance record
app.post('/api/attendance', async (req, res) => {
    const { employeeId, date, clockIn, clockOut, duration, status } = req.body;

    // Validate inputs
    if (!employeeId || !/^(ATS0(?!000)\d{3})$/.test(employeeId)) {
        return res.status(400).json({ error: 'Invalid Employee ID. Must be ATS0 followed by 4 digits (e.g., ATS0987)' });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Invalid date format' });
    }
    if (!status || !['present', 'late', 'absent'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be present, late, or absent' });
    }
    if (clockIn && !/^\d{2}:\d{2}$/.test(clockIn)) {
        return res.status(400).json({ error: 'Invalid clockIn time format' });
    }
    if (clockOut && !/^\d{2}:\d{2}$/.test(clockOut)) {
        return res.status(400).json({ error: 'Invalid clockOut time format' });
    }
    if (duration && !/^\d+h \d+m$/.test(duration)) {
        return res.status(400).json({ error: 'Invalid duration format' });
    }

    try {
        // Check for existing record
        const existingRecord = await pool.query(
            'SELECT * FROM attendance WHERE employee_id = $1 AND date = $2',
            [employeeId, date]
        );
        if (existingRecord.rows.length > 0) {
            return res.status(400).json({ error: 'Attendance record already exists for this Employee ID and date' });
        }

        // Insert new record
        const result = await pool.query(
            `INSERT INTO attendance (employee_id, date, clock_in, clock_out, duration, status)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [employeeId, date, clockIn || null, clockOut || null, duration || null, status]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error adding attendance record:', err.stack);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT to update an existing attendance record
app.put('/api/attendance/:employeeId/:date', async (req, res) => {
    const { employeeId, date } = req.params;
    const { clockIn, clockOut, duration, status } = req.body;

    // Validate inputs
    if (!employeeId || !/^(ATS0(?!000)\d{3})$/.test(employeeId)) {
        return res.status(400).json({ error: 'Invalid Employee ID. Must be ATS0 followed by 4 digits (e.g., ATS0987)' });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Invalid date format' });
    }
    if (!status || !['present', 'late', 'absent'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be present, late, or absent' });
    }
    if (clockIn && !/^\d{2}:\d{2}$/.test(clockIn)) {
        return res.status(400).json({ error: 'Invalid clockIn time format' });
    }
    if (clockOut && !/^\d{2}:\d{2}$/.test(clockOut)) {
        return res.status(400).json({ error: 'Invalid clockOut time format' });
    }
    if (duration && !/^\d+h \d+m$/.test(duration)) {
        return res.status(400).json({ error: 'Invalid duration format' });
    }

    try {
        // Check for existing record
        const existingRecord = await pool.query(
            'SELECT * FROM attendance WHERE employee_id = $1 AND date = $2',
            [employeeId, date]
        );
        if (existingRecord.rows.length === 0) {
            return res.status(404).json({ error: 'Attendance record not found' });
        }

        // Update record
        const result = await pool.query(
            `UPDATE attendance
             SET clock_in = $1, clock_out = $2, duration = $3, status = $4
             WHERE employee_id = $5 AND date = $6
             RETURNING *`,
            [clockIn || null, clockOut || null, duration || null, status, employeeId, date]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating attendance record:', err.stack);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});