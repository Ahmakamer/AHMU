// Explicitly set environment variables
process.env.NODE_ENV = 'production';
process.env.DATABASE_URL = 'postgres://ahmukoaa_ahmuuko:ahmakamer1992@localhost:5432/ahmukoaa_ahmaa';
process.env.SESSION_SECRET = 'ahma';
process.env.PORT = '3000';

// Load environment variables from .env file (optional)
require('dotenv').config({ path: __dirname + '/.env' });

// Start the server
require('./index.js');
