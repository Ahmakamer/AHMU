const express = require('express');
const cors = require('cors');
const { registerRoutes } = require("./routes");
const { setupVite, serveStatic } = require("./vite");
const { createServer } = require("http");
const path = require("path");
const fs = require("fs");
const mime = require('mime-types');
const logger = require('./logger');

const app = express();

// Enhanced security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Handle www and non-www redirects
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    const host = req.hostname;
    // Redirect www to non-www
    if (host.startsWith('www.')) {
      const newHost = host.slice(4);
      return res.redirect(301, `${req.protocol}://${newHost}${req.originalUrl}`);
    }
  }
  next();
});

// CORS configuration for development
if (app.get("env") === "development") {
  app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
  }));
}

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

(async () => {
  registerRoutes(app);
  const server = createServer(app);

  app.use((err, req, res, next) => {
    logger.error('Error:', { 
      error: err.message, 
      stack: err.stack,
      path: req.path,
      method: req.method
    });
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    const publicDir = path.resolve("dist/public");
    const indexPath = path.join(publicDir, "index.html");

    // Ensure dist/public directory exists
    if (!fs.existsSync(publicDir)) {
      try {
        fs.mkdirSync(publicDir, { recursive: true });
        console.log('Created dist/public directory');
      } catch (error) {
        console.error(`Failed to create dist/public directory: ${error}`);
        process.exit(1);
      }
    }

    // Run build if index.html doesn't exist
    if (!fs.existsSync(indexPath)) {
      console.log('Building application...');
      try {
        require('child_process').execSync('npm run build', { 
          stdio: 'inherit',
          env: { ...process.env, NODE_ENV: 'production' }
        });
      } catch (error) {
        console.error(`Build failed: ${error}`);
        process.exit(1);
      }
    }

    // Verify index.html exists after build
    if (!fs.existsSync(indexPath)) {
      console.error('Build completed but index.html not found in public directory');
      process.exit(1);
    }

    // Advanced static file serving with proper MIME types and caching
    app.use(express.static(publicDir, {
      maxAge: '30d',
      etag: true,
      lastModified: true,
      index: ['index.html', '404.html'],
      dotfiles: 'ignore',
      setHeaders: (res, filePath) => {
        const mimeType = mime.lookup(filePath) || 'application/octet-stream';
        res.setHeader('Content-Type', mimeType);

        // Cache control based on file type
        if (mimeType.startsWith('image/')) {
          res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30 days
        } else if (mimeType === 'application/javascript' || mimeType === 'text/css') {
          res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
        } else if (mimeType === 'text/html') {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
        }

        // Security headers for static files
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (mimeType === 'text/html') {
          res.setHeader('X-Frame-Options', 'DENY');
          res.setHeader('X-XSS-Protection', '1; mode=block');
          res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https:;");
        }
      }
    }));

    // Handle API routes first
    app.use('/api/*', (req, res, next) => {
      next();
    });

    // Serve index.html for all non-API routes
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }

      // Try to serve the requested file first
      const filePath = path.join(publicDir, req.path);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return res.sendFile(filePath);
      }

      // Serve index.html with proper error handling
      res.sendFile(indexPath, (err) => {
        if (err) {
          console.error(`Error serving index.html: ${err}`);
          // Try 404.html as fallback
          const notFoundPath = path.join(publicDir, '404.html');
          if (fs.existsSync(notFoundPath)) {
            res.status(404).sendFile(notFoundPath);
          } else {
            next(new Error('Failed to serve application'));
          }
        }
      });
    });
  }

  const port = parseInt(process.env.PORT || '5000');
  server.listen(port, "0.0.0.0", () => {
    const formattedTime = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

    logger.info(`Server running on port ${port} in ${process.env.NODE_ENV} mode`);
  });
})();

module.exports = app;
