require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const moment = require('moment');

const app = express();
const port = process.env.PORT || 3063;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'postgres',
    database: process.env.DB_NAME || 'attendance_system',
    password: process.env.DB_PASSWORD || 'admin123',
    port: process.env.DB_PORT || 5432,
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error acquiring client', err.stack);
    }
    console.log('Connected to PostgreSQL database');
    release();
});

// Create or update attendance table
async function initializeDatabase() {
    try {
        // Create attendance table if it doesn't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS attendance (
                id SERIAL PRIMARY KEY,
                employee_id VARCHAR(7) NOT NULL CHECK (employee_id ~ '^ATS0[0-9]{3}$'),
                date DATE NOT NULL,
                clock_in TIME,
                clock_out TIME,
                duration VARCHAR(20),
                status VARCHAR(20),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(employee_id, date)
            );
        `);

        // Check if updated_at column exists, and add it if missing
        const columnCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'attendance' AND column_name = 'updated_at';
        `);

        if (columnCheck.rows.length === 0) {
            await pool.query(`
                ALTER TABLE attendance 
                ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
            `);
            console.log('Added updated_at column to attendance table');
        }

        console.log('Attendance table initialized');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

initializeDatabase();

// Helper functions
function calculateDuration(clockIn, clockOut) {
    if (!clockIn || !clockOut) return '0h 0m';
    
    const start = moment(clockIn, 'HH:mm:ss');
    const end = moment(clockOut, 'HH:mm:ss');
    const duration = moment.duration(end.diff(start));
    
    const hours = Math.floor(duration.asHours());
    const minutes = duration.minutes();
    return `${hours}h ${minutes}m`;
}

function determineStatus(clockIn) {
    if (!clockIn) return 'absent';
    
    const [hours, minutes] = clockIn.split(':').map(Number);
    
    if (hours < 10 || (hours === 10 && minutes <= 0)) {
        return 'present';
    } else if (hours === 10 && minutes <= 15) {
        return 'late';
    } else {
        return 'late';
    }
}

// API Routes for Attendance

// Get all attendance records (with optional employee_id filter)
app.get('/api/attendance', async (req, res) => {
    try {
        const { employee_id } = req.query;
        let query = 'SELECT * FROM attendance';
        let params = [];
        
        if (employee_id) {
            query += ' WHERE employee_id = $1';
            params.push(employee_id);
        }
        
        query += ' ORDER BY date DESC, clock_in DESC';
        
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching attendance records:', error);
        res.status(500).json({ error: 'Failed to fetch attendance records' });
    }
});

// Get today's attendance record for an employee
app.get('/api/attendance/today/:employee_id', async (req, res) => {
    try {
        const today = moment().format('YYYY-MM-DD');
        const { rows } = await pool.query(
            'SELECT * FROM attendance WHERE employee_id = $1 AND date = $2',
            [req.params.employee_id, today]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'No record found for today' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('Error fetching today\'s attendance:', error);
        res.status(500).json({ error: 'Failed to fetch today\'s attendance' });
    }
});

// Create new attendance record (clock in)
app.post('/api/attendance', async (req, res) => {
    try {
        const { employeeId, date, clockIn } = req.body;
        
        // Validate employee_id format
        if (!employeeId.match(/^ATS0[0-9]{3}$/)) {
            return res.status(400).json({ error: 'Invalid employee ID format' });
        }
        
        // Check if record already exists for this date
        const existingRecord = await pool.query(
            'SELECT * FROM attendance WHERE employee_id = $1 AND date = $2',
            [employeeId, date]
        );
        
        if (existingRecord.rows.length > 0) {
            return res.status(400).json({ error: 'Attendance record already exists for this date' });
        }
        
        const status = determineStatus(clockIn);
        
        const { rows } = await pool.query(
            `INSERT INTO attendance (employee_id, date, clock_in, status)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [employeeId, date, clockIn, status]
        );
        
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Error creating attendance record:', error);
        res.status(500).json({ error: 'Failed to create attendance record' });
    }
});

// Update attendance record (clock out)
app.put('/api/attendance/:employee_id/:date', async (req, res) => {
    try {
        const { employee_id, date } = req.params;
        const { clockOut } = req.body;
        
        // Validate employee_id format
        if (!employee_id.match(/^ATS0[0-9]{3}$/)) {
            return res.status(400).json({ error: 'Invalid employee ID format' });
        }
        
        // Get existing record to calculate duration
        const { rows } = await pool.query(
            'SELECT * FROM attendance WHERE employee_id = $1 AND date = $2',
            [employee_id, date]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Record not found' });
        }
        
        const record = rows[0];
        
        // Don't allow clock out if not clocked in
        if (!record.clock_in) {
            return res.status(400).json({ error: 'Cannot clock out without clocking in first' });
        }
        
        const duration = calculateDuration(record.clock_in, clockOut);
        
        const updatedRecord = await pool.query(
            `UPDATE attendance 
             SET clock_out = $1, duration = $2, updated_at = NOW()
             WHERE employee_id = $3 AND date = $4
             RETURNING *`,
            [clockOut, duration, employee_id, date]
        );
        
        res.json(updatedRecord.rows[0]);
    } catch (error) {
        console.error('Error updating attendance record:', error);
        res.status(500).json({ error: 'Failed to update attendance record' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});