const passport = require('passport');
const { Strategy as LocalStrategy } = require('passport-local');
const { type Express } = require('express');
const session = require('express-session');
const createMemoryStore = require('memorystore');
const { scrypt, randomBytes, timingSafeEqual } = require('crypto');
const { promisify } = require('util');
const { users, insertUserSchema, type User as SelectUser } = require('db/schema');
const { db } = require('db');
const { eq } = require('drizzle-orm');
const { z } = require('zod');

const scryptAsync = promisify(scrypt);
const crypto = {
  hash: async (password) => {
    const salt = randomBytes(16).toString('hex');
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString('hex')}.${salt}`;
  },
  compare: async (suppliedPassword, storedPassword) => {
    const [hashedPassword, salt] = storedPassword.split('.');
    const hashedPasswordBuf = Buffer.from(hashedPassword, 'hex');
    const suppliedPasswordBuf = (await scryptAsync(suppliedPassword, salt, 64)) as Buffer;
    return timingSafeEqual(hashedPasswordBuf, suppliedPasswordBuf);
  },
};

const loginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
});

const registerSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  email: z.string().email(),
  phone: z.string().regex(/^[0-9]{10,}$/, 'Phone number must be at least 10 digits'),
});

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const setupAuth = (app) => {
  const MemoryStore = createMemoryStore(session);
  const sessionSettings = {
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: true,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
    },
    store: new MemoryStore({
      checkPeriod: 86400000,
    }),
  };

  if (app.get('env') === 'production') {
    app.set('trust proxy', 1);
    if (sessionSettings.cookie) sessionSettings.cookie.secure = true;
  }

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.username, username))
          .limit(1);

        if (!user) {
          return done(null, false, { message: 'Incorrect username.' });
        }
        const isMatch = await crypto.compare(password, user.password);
        if (!isMatch) {
          return done(null, false, { message: 'Incorrect password.' });
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    })
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!user) return done(null, false);
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  });

  // Registration endpoint
  app.post('/api/register', async (req, res) => {
    try {
      const { username, password, email, phone } = registerSchema.parse(req.body);

      // Check if user already exists
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .or(eq(users.email, email))
        .or(eq(users.phone, phone))
        .limit(1);

      if (existingUser.length > 0) {
        return res.status(400).json({
          error: 'User already exists with this username, email, or phone number',
        });
      }

      // Hash password and create user
      const hashedPassword = await crypto.hash(password);
      const [user] = await db
        .insert(users)
        .values({
          username,
          password: hashedPassword,
          email,
          phone,
        })
        .returning();

      // Log the user in after registration
      req.login(user, (err) => {
        if (err) {
          return res.status(500).json({ error: 'Error logging in after registration' });
        }
        return res.json({ user: { id: user.id, username: user.username, email: user.email } });
      });
    } catch (error) {
      console.error('Registration error:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Login endpoint
  app.post('/api/login', (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      if (!user) {
        return res.status(401).json({ error: info.message });
      }
      req.login(user, (err) => {
        if (err) {
          return res.status(500).json({ error: 'Error logging in' });
        }
        return res.json({ user: { id: user.id, username: user.username, email: user.email } });
      });
    })(req, res, next);
  });

  // Logout endpoint
  app.post('/api/logout', (req, res) => {
    req.logout(() => {
      res.json({ message: 'Logged out successfully' });
    });
  });

  // Get current user endpoint
  app.get('/api/user', (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const user = req.user;
    res.json({ user: { id: user.id, username: user.username, email: user.email } });
  });

  // Add user details endpoint
  app.get('/api/users/:id', async (req, res) => {
    try {
      const [user] = await db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, parseInt(req.params.id)))
        .limit(1);

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.json(user);
    } catch (error) {
      console.error('Error fetching user:', error);
      res.status(500).json({
        message: 'Failed to fetch user',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};

module.exports = { setupAuth };
