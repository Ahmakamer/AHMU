import { desc, eq, or, ilike, and, count, sql } from "drizzle-orm";
import { Express, static as expressStatic } from "express";
import { setupAuth } from "./auth";
import { db } from "db";
import { listings, messages, users, categories, bookmarks, listingViews, premiumPayments, premiumTiers } from "db/schema";
import { eq, and, or, gte, lte, ilike, sql, desc, ne } from "drizzle-orm";
import multer from 'multer';
import path from 'path';
import { mkdirSync } from 'fs';
import geoip from 'geoip-lite';

// Create uploads directory if it doesn't exist
try {
  mkdirSync('uploads');
} catch (err: any) {
  if (err.code !== 'EEXIST') throw err;
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const filename = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '-');
    cb(null, `${filename}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!allowedTypes.includes(file.mimetype)) {
      cb(new Error('Invalid file type. Only JPEG, PNG and GIF are allowed.'));
      return;
    }
    cb(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

export function registerRoutes(app: Express) {
  setupAuth(app);

  // Auth middleware for protected routes
  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next();
  };

  // Update username endpoint
  app.put("/api/user/username", requireAuth, async (req, res) => {
    try {
      const { username } = req.body;

      if (!username || typeof username !== 'string' || username.length < 3) {
        return res.status(400).json({ message: "Username must be at least 3 characters long" });
      }

      // Check if username is already taken
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (existingUser && existingUser.id !== req.user.id) {
        return res.status(400).json({ message: "Username already taken" });
      }

      // Update username
      const [updatedUser] = await db
        .update(users)
        .set({ username })
        .where(eq(users.id, req.user.id))
        .returning();

      res.json({
        message: "Username updated successfully",
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          email: updatedUser.email,
          profilePhoto: updatedUser.profilePhoto
        }
      });
    } catch (error) {
      console.error('Error updating username:', error);
      res.status(500).json({ 
        message: "Failed to update username",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Profile photo upload endpoint
  app.post("/api/profile/photo", requireAuth, upload.single('photo'), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const [updatedUser] = await db
        .update(users)
        .set({
          profilePhoto: `/uploads/${file.filename}`
        })
        .where(eq(users.id, req.user.id))
        .returning();

      res.json({
        message: "Profile photo updated successfully",
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          email: updatedUser.email,
          profilePhoto: updatedUser.profilePhoto
        }
      });
    } catch (error) {
      console.error('Error uploading profile photo:', error);
      res.status(500).json({
        message: "Failed to update profile photo",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });


  app.use('/uploads', expressStatic('uploads', {
    maxAge: '1d',
    etag: true
  }));

  // Premium payment submission endpoint
  // Get premium tiers
  app.get("/api/premium-tiers", async (req, res) => {
    try {
      const tiers = await db
        .select()
        .from(premiumTiers)
        .orderBy(premiumTiers.price);
      
      res.json(tiers);
    } catch (error) {
      console.error('Error fetching premium tiers:', error);
      res.status(500).json({
        message: "Failed to fetch premium tiers",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  app.post("/api/premium-payments", requireAuth, upload.single('paymentProof'), async (req, res) => {
    try {
      const file = req.file;
      const { listingId } = req.body;

      if (!file) {
        return res.status(400).json({ message: "Payment proof is required" });
      }

      const [payment] = await db
        .insert(premiumPayments)
        .values({
          listingId: parseInt(listingId),
          userId: req.user.id,
          paymentProof: `/uploads/${file.filename}`,
          tierId: parseInt(req.body.tierId),
          amount: (await db.select().from(premiumTiers).where(eq(premiumTiers.id, parseInt(req.body.tierId))).limit(1))[0].price,
          status: "pending"
        })
        .returning();

      res.json(payment);
    } catch (error) {
      console.error('Error creating premium payment:', error);
      res.status(500).json({
        message: "Failed to submit payment proof",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Admin Routes
  app.get("/api/admin/premium-payments", requireAuth, async (req, res) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    try {
      const payments = await db
        .select({
          payment: {
            id: premiumPayments.id,
            status: premiumPayments.status,
            amount: premiumPayments.amount,
            paymentProof: premiumPayments.paymentProof,
            createdAt: premiumPayments.createdAt
          },
          user: {
            id: users.id,
            username: users.username
          },
          listing: {
            id: listings.id,
            title: listings.title
          }
        })
        .from(premiumPayments)
        .innerJoin(users, eq(premiumPayments.userId, users.id))
        .innerJoin(listings, eq(premiumPayments.listingId, listings.id))
        .orderBy(desc(premiumPayments.createdAt));

      res.json(payments);
    } catch (error) {
      console.error('Error fetching premium payments:', error);
      res.status(500).json({
        message: "Failed to fetch premium payments",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.put("/api/admin/premium-payments/:id", requireAuth, async (req, res) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    try {
      const paymentId = parseInt(req.params.id);
      const { status } = req.body;

      const [payment] = await db
        .update(premiumPayments)
        .set({ status })
        .where(eq(premiumPayments.id, paymentId))
        .returning();

      if (status === "approved") {
        const [tier] = await db
          .select()
          .from(premiumTiers)
          .where(eq(premiumTiers.id, payment.tierId))
          .limit(1);

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + tier.durationDays);

        await db
          .update(listings)
          .set({ 
            isPremium: true,
            premiumTierId: payment.tierId,
            premiumExpiresAt: expiresAt
          })
          .where(eq(listings.id, payment.listingId));

        await db
          .update(premiumPayments)
          .set({ expiresAt })
          .where(eq(premiumPayments.id, payment.id));
      }

      res.json(payment);
    } catch (error) {
      console.error('Error updating payment status:', error);
      res.status(500).json({
        message: "Failed to update payment status",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Admin Routes
  app.get("/api/admin/analytics/overview", requireAuth, async (req, res) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    try {
      // Get total users
      const [userCount] = await db
        .select({ 
          count: sql<number>`count(*)::int`
        })
        .from(users);

      // Get total listings
      const [listingCount] = await db
        .select({ 
          count: sql<number>`count(*)::int`
        })
        .from(listings)
        .where(eq(listings.status, 'active'));

      // Get total messages
      const [messageCount] = await db
        .select({ 
          count: sql<number>`count(*)::int`
        })
        .from(messages);

      // Get listings by status
      const listingsByStatus = await db
        .select({
          status: listings.status,
          count: sql<number>`count(*)::int`
        })
        .from(listings)
        .groupBy(listings.status);

      // Get listings by category
      const listingsByCategory = await db
        .select({
          categoryName: categories.name,
          count: sql<number>`count(*)::int`
        })
        .from(listings)
        .leftJoin(categories, eq(listings.categoryId, categories.id))
        .where(eq(listings.status, 'active'))
        .groupBy(categories.name);

      res.json({
        overview: {
          totalUsers: userCount.count,
          totalListings: listingCount.count,
          totalMessages: messageCount.count
        },
        listingsByStatus,
        listingsByCategory
      });
    } catch (error) {
      console.error('Error fetching admin analytics:', error);
      res.status(500).json({
        message: "Failed to fetch analytics",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/admin/listings", requireAuth, async (req, res) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    try {
      const results = await db
        .select({
          id: listings.id,
          title: listings.title,
          price: listings.price,
          status: listings.status,
          userId: listings.userId,
          createdAt: listings.createdAt
        })
        .from(listings)
        .orderBy(sql`${listings.createdAt} DESC`);

      res.json(results);
    } catch (error) {
      console.error('Error fetching admin listings:', error);
      res.status(500).json({
        message: "Failed to fetch listings",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.put("/api/admin/listings/:id", requireAuth, async (req, res) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    try {
      const listingId = parseInt(req.params.id);
      const { status } = req.body;

      if (!['active', 'removed', 'deleted'].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const [updatedListing] = await db
        .update(listings)
        .set({
          status,
          updatedAt: new Date()
        })
        .where(eq(listings.id, listingId))
        .returning();

      res.json(updatedListing);
    } catch (error) {
      console.error('Error updating listing status:', error);
      res.status(500).json({
        message: "Failed to update listing status",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Track listing view with enhanced tracking
  app.post("/api/listings/:id/view", async (req, res) => {
    try {
      const listingId = parseInt(req.params.id);
      const viewerId = req.user?.id;
      const ipAddress = req.ip;
      const userAgent = req.headers['user-agent'];
      
      // Get geolocation data
      const geo = geoip.lookup(ipAddress);
      const geoLocation = geo ? {
        country: geo.country,
        city: geo.city,
        region: geo.region
      } : {};

      // Check for return visitor (viewed in last 7 days)
      const [previousView] = await db
        .select()
        .from(listingViews)
        .where(
          and(
            eq(listingViews.listingId, listingId),
            eq(listingViews.ipAddress, ipAddress),
            sql`${listingViews.createdAt} > NOW() - INTERVAL '7 days'`,
            sql`${listingViews.createdAt} < NOW() - INTERVAL '24 hours'`
          )
        )
        .limit(1);

      // Check if this IP has viewed this listing in the last hour
      const [recentView] = await db
        .select()
        .from(listingViews)
        .where(
          and(
            eq(listingViews.listingId, listingId),
            eq(listingViews.ipAddress, ipAddress),
            sql`${listingViews.createdAt} > NOW() - INTERVAL '1 hour'`
          )
        )
        .limit(1);

      if (recentView) {
        // Update existing view's duration if within the hour
        await db
          .update(listingViews)
          .set({
            viewEndTime: new Date(),
            sessionDuration: sql`EXTRACT(EPOCH FROM (NOW() - ${listingViews.viewStartTime}))::integer`
          })
          .where(eq(listingViews.id, recentView.id));
        
        return res.json({ message: "View duration updated" });
      }

      const [view] = await db
        .insert(listingViews)
        .values({
          listingId,
          viewerId,
          ipAddress,
          userAgent,
          geoLocation,
          viewStartTime: new Date(),
          isReturn: !!previousView
        })
        .returning();

      res.json(view);
    } catch (error) {
      console.error('Error tracking view:', error);
      res.status(500).json({
        message: "Failed to track view",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get listing analytics
  app.get("/api/listings/:id/analytics", requireAuth, async (req, res) => {
    try {
      const listingId = parseInt(req.params.id);
      
      // Verify listing ownership
      const [listing] = await db
        .select()
        .from(listings)
        .where(eq(listings.id, listingId))
        .limit(1);

      if (!listing || listing.userId !== req.user.id) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Get total views and unique visitors
      const [viewsResult] = await db
        .select({ 
          total: sql<number>`count(*)::int`,
          unique: sql<number>`count(distinct ${listingViews.ipAddress})::int`,
          returningVisitors: sql<number>`count(distinct case when ${listingViews.isReturn} then ${listingViews.ipAddress} end)::int`,
          avgDuration: sql<number>`avg(${listingViews.sessionDuration})::int`
        })
        .from(listingViews)
        .where(eq(listingViews.listingId, listingId));

      // Get hourly view breakdown (last 24 hours)
      const hourlyViews = await db
        .select({
          hour: sql<string>`to_char(${listingViews.createdAt}, 'HH24:00')`,
          count: sql<number>`count(*)::int`
        })
        .from(listingViews)
        .where(
          and(
            eq(listingViews.listingId, listingId),
            sql`${listingViews.createdAt} > NOW() - INTERVAL '24 hours'`
          )
        )
        .groupBy(sql`to_char(${listingViews.createdAt}, 'HH24:00')`)
        .orderBy(sql`to_char(${listingViews.createdAt}, 'HH24:00')`);

      // Get daily views (last 7 days)
      const dailyViews = await db
        .select({
          date: sql<string>`date_trunc('day', ${listingViews.createdAt})::date`,
          count: sql<number>`count(*)::int`
        })
        .from(listingViews)
        .where(
          and(
            eq(listingViews.listingId, listingId),
            sql`${listingViews.createdAt} > NOW() - INTERVAL '7 days'`
          )
        )
        .groupBy(sql`date_trunc('day', ${listingViews.createdAt})`)
        .orderBy(sql`date_trunc('day', ${listingViews.createdAt})`);

      // Get geographic distribution
      const geoDistribution = await db
        .select({
          country: sql<string>`${listingViews.geoLocation}->>'country'`,
          count: sql<number>`count(*)::int`
        })
        .from(listingViews)
        .where(eq(listingViews.listingId, listingId))
        .groupBy(sql`${listingViews.geoLocation}->>'country'`)
        .having(sql`${listingViews.geoLocation}->>'country' is not null`);

      // Get message count
      const [messageCount] = await db
        .select({ 
          count: sql<number>`count(*)::int`
        })
        .from(messages)
        .where(eq(messages.listingId, listingId));

      res.json({
        views: {
          total: viewsResult.total,
          unique: viewsResult.unique,
          returningVisitors: viewsResult.returningVisitors,
          avgDuration: viewsResult.avgDuration
        },
        hourlyViews,
        dailyViews,
        geoDistribution,
        messageCount: messageCount.count
      });
    } catch (error) {
      console.error('Error fetching analytics:', error);
      res.status(500).json({
        message: "Failed to fetch analytics",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Public routes
  app.get("/api/listings", async (req, res) => {
    try {
      const { query, minPrice, maxPrice, condition, location, category } = req.query;
      
      let conditions = [];
      conditions.push(eq(listings.status, 'active'));

      // Get users with search functionality
      app.get("/api/admin/users", requireAuth, async (req, res) => {
        if (!req.user?.isAdmin) {
          return res.status(403).json({ message: "Unauthorized" });
        }

        try {
          const { search } = req.query;
          let query = db.select().from(users);

          if (search && typeof search === 'string') {
            query = query.where(
              or(
                like(users.username, `%${search}%`),
                like(users.email, `%${search}%`)
              )
            );
          }

          const results = await query.orderBy(desc(users.createdAt));
          
          // Remove sensitive information
          const sanitizedUsers = results.map(user => ({
            id: user.id,
            username: user.username,
            email: user.email,
            isAdmin: user.isAdmin,
            isVerifiedSeller: user.isVerifiedSeller,
            createdAt: user.createdAt,
            profilePhoto: user.profilePhoto
          }));

          res.json(sanitizedUsers);
        } catch (error) {
          console.error('Error fetching users:', error);
          res.status(500).json({
            message: "Failed to fetch users",
            error: error instanceof Error ? error.message : String(error)
          });
        }
      });

      // Reset user password
      app.post("/api/admin/users/:id/reset-password", requireAuth, async (req, res) => {
        if (!req.user?.isAdmin) {
          return res.status(403).json({ message: "Unauthorized" });
        }

        try {
          const userId = parseInt(req.params.id);
          const { newPassword } = req.body;

          if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
            return res.status(400).json({ message: "Password must be at least 6 characters long" });
          }

          const hashedPassword = await bcrypt.hash(newPassword, 10);

          const [updatedUser] = await db
            .update(users)
            .set({ password: hashedPassword })
            .where(eq(users.id, userId))
            .returning();

          if (!updatedUser) {
            return res.status(404).json({ message: "User not found" });
          }

          res.json({ message: "Password reset successfully" });
        } catch (error) {
          console.error('Error resetting password:', error);
          res.status(500).json({
            message: "Failed to reset password",
            error: error instanceof Error ? error.message : String(error)
          });
        }
  // Admin user management endpoint
  app.get("/api/admin/users", requireAuth, async (req, res) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    try {
      const search = req.query.search as string | undefined;
      const page = parseInt(req.query.page as string) || 1;
      const limit = 10;
      const offset = (page - 1) * limit;

      let query = db.select().from(users);

      // Add search condition if search term is provided
      if (search) {
        query = query.where(
          or(
            ilike(users.username, `%${search}%`),
            ilike(users.email, `%${search}%`)
          )
        );
      }

      // Get total count
      const [{ value: totalItems }] = await db
        .select({ value: count() })
        .from(users)
        .where(search ? or(
          ilike(users.username, `%${search}%`),
          ilike(users.email, `%${search}%`)
        ) : undefined);

      // Get paginated results
      const results = await query
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset);

      const totalPages = Math.ceil(totalItems / limit);

      res.json({
        success: true,
        data: results,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems,
          itemsPerPage: limit,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1
        }
      });
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch users",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Update user role
  app.put("/api/admin/users/:id/role", requireAuth, async (req, res) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    try {
      const userId = parseInt(req.params.id);
      const { isAdmin } = req.body;

      if (userId === req.user.id) {
        return res.status(400).json({ message: "Cannot modify your own admin status" });
      }

      const [updatedUser] = await db
        .update(users)
        .set({ isAdmin: isAdmin })
        .where(eq(users.id, userId))
        .returning();

      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ message: "User role updated successfully" });
    } catch (error) {
      console.error('Error updating user role:', error);
      res.status(500).json({
        message: "Failed to update user role",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

      

  // Admin password reset endpoint
  app.post("/api/admin/users/:id/reset-password", requireAuth, async (req, res) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    try {
      const userId = parseInt(req.params.id);
      const { newPassword } = req.body;

      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters long" });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      const [updatedUser] = await db
        .update(users)
        .set({ password: hashedPassword })
        .where(eq(users.id, userId))
        .returning();

      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ message: "Password reset successfully" });
    } catch (error) {
      console.error('Error resetting password:', error);
      res.status(500).json({
        message: "Failed to reset password",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

      if (query && typeof query === 'string') {
        conditions.push(
          or(
            ilike(listings.title, `%${query}%`),
            ilike(listings.description, `%${query}%`)
          )
        );
      }

      if (minPrice && !isNaN(Number(minPrice))) {
        conditions.push(gte(listings.price, parseInt(minPrice as string)));
      }

      if (maxPrice && !isNaN(Number(maxPrice))) {
        conditions.push(lte(listings.price, parseInt(maxPrice as string)));
      }

      if (condition && typeof condition === 'string') {
        conditions.push(eq(listings.condition, condition));
      }

      if (location && typeof location === 'string') {
        conditions.push(ilike(listings.location, `%${location}%`));
      }

      if (category && typeof category === 'string') {
        const [categoryRecord] = await db
          .select()
          .from(categories)
          .where(eq(categories.slug, category))
          .limit(1);
          
        if (categoryRecord) {
          conditions.push(eq(listings.categoryId, categoryRecord.id));
        }
      }

      const results = await db
        .select()
        .from(listings)
        .where(and(...conditions))
        .orderBy(
          desc(listings.isPremium),
          desc(listings.createdAt)
        );
      
      res.json(results);
    } catch (error) {
      console.error('Error fetching listings:', error);
      res.status(500).json({
        message: "Failed to fetch listings",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get single listing endpoint (public)
  app.get("/api/listings/:id", async (req, res) => {
    try {
      const [listing] = await db
        .select()
        .from(listings)
        .where(eq(listings.id, parseInt(req.params.id)))
        .limit(1);
      
      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
      }
      res.json(listing);
    } catch (error) {
      console.error('Error fetching listing:', error);
      res.status(500).json({ 
        message: "Failed to fetch listing",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  // Get similar listings endpoint
  app.get("/api/listings/:id/related", async (req, res) => {
    try {
      const [listing] = await db
        .select()
        .from(listings)
        .where(eq(listings.id, parseInt(req.params.id)))
        .limit(1);
      
      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
      }

      // Get listings from the same category
      const similarListings = await db
        .select()
        .from(listings)
        .where(
          and(
            eq(listings.categoryId, listing.categoryId),
            eq(listings.status, 'active'),
            ne(listings.id, listing.id)
          )
        )
        .orderBy(
          desc(listings.isPremium),
          desc(listings.createdAt)
        )
        .limit(4);
      
      res.json(similarListings);
    } catch (error) {
      console.error('Error fetching similar listings:', error);
      res.status(500).json({
        message: "Failed to fetch similar listings",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });


  // Protected routes
  app.post("/api/listings", requireAuth, upload.array('images', 5), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      const formData = req.body;

      // Generate URLs for uploaded files
      const imageUrls = files?.map(file => `/uploads/${file.filename}`) || [];

      // Parse specifications safely
      let specifications = {};
      try {
        specifications = formData.specifications ? JSON.parse(formData.specifications) : {};
      } catch (e) {
        console.error('Error parsing specifications:', e);
      }

      const [listing] = await db
        .insert(listings)
        .values({
          title: formData.title.trim(),
          description: formData.description.trim(),
          price: parseInt(formData.price),
          categoryId: parseInt(formData.categoryId),
          userId: req.user.id,
          images: imageUrls,
          location: formData.location?.trim() || null,
          phoneNumber: formData.phoneNumber.trim(),
          condition: formData.condition?.trim() || 'New',
          brand: formData.brand?.trim() || null,
          model: formData.model?.trim() || null,
          subtype: formData.subtype?.trim() || null,
          specifications: specifications,
          status: 'active'
        })
        .returning();

      res.json(listing);
    } catch (error) {
      console.error('Error creating listing:', error);
      res.status(500).json({ 
        message: "Failed to create listing",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.put("/api/listings/:id", requireAuth, upload.array('images', 5), async (req, res) => {
    try {
      const listingId = parseInt(req.params.id);
      if (isNaN(listingId)) {
        return res.status(400).json({ message: "Invalid listing ID" });
      }

      const [existingListing] = await db
        .select()
        .from(listings)
        .where(eq(listings.id, listingId))
        .limit(1);

      if (!existingListing) {
        return res.status(404).json({ message: "Listing not found" });
      }

      // Check if user owns the listing
      if (existingListing.userId !== req.user.id) {
        return res.status(403).json({ message: "You don't have permission to edit this listing" });
      }

      const files = req.files as Express.Multer.File[];
      const formData = req.body;

      // Generate URLs for any new uploaded files
      const newImageUrls = files?.map(file => `/uploads/${file.filename}`) || [];

      // Combine existing and new images if needed
      const keepImages = formData.keepImages ? formData.keepImages.split(',') : [];
      const updatedImages = [...keepImages, ...newImageUrls];

      // Parse specifications safely
      let specifications = {};
      try {
        specifications = formData.specifications ? JSON.parse(formData.specifications) : {};
      } catch (e) {
        console.error('Error parsing specifications:', e);
      }

      const [updatedListing] = await db
        .update(listings)
        .set({
          title: formData.title?.trim() || existingListing.title,
          description: formData.description?.trim() || existingListing.description,
          price: formData.price ? parseInt(formData.price) : existingListing.price,
          categoryId: formData.categoryId ? parseInt(formData.categoryId) : existingListing.categoryId,
          images: updatedImages.length > 0 ? updatedImages : existingListing.images,
          location: formData.location?.trim() || existingListing.location,
          phoneNumber: formData.phoneNumber?.trim() || existingListing.phoneNumber,
          condition: formData.condition?.trim() || existingListing.condition,
          brand: formData.brand?.trim() || existingListing.brand,
          model: formData.model?.trim() || existingListing.model,
          subtype: formData.subtype?.trim() || existingListing.subtype,
          specifications: Object.keys(specifications).length > 0 ? specifications : existingListing.specifications,
          updatedAt: new Date()
        })
        .where(eq(listings.id, listingId))
        .returning();

      res.json(updatedListing);
    } catch (error) {
      console.error('Error updating listing:', error);
      res.status(500).json({ 
        message: "Failed to update listing",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.delete("/api/listings/:id", requireAuth, async (req, res) => {
    try {
      const listingId = parseInt(req.params.id);
      if (isNaN(listingId)) {
        return res.status(400).json({ message: "Invalid listing ID" });
      }

      const [existingListing] = await db
        .select()
        .from(listings)
        .where(eq(listings.id, listingId))
        .limit(1);

      if (!existingListing) {
        return res.status(404).json({ message: "Listing not found" });
      }

      // Check if user owns the listing
      if (existingListing.userId !== req.user.id) {
        return res.status(403).json({ message: "You don't have permission to delete this listing" });
      }

      const [deletedListing] = await db
        .update(listings)
        .set({
          status: 'deleted',
          updatedAt: new Date()
        })
        .where(eq(listings.id, listingId))
        .returning();

      res.json({ message: "Listing deleted successfully", listing: deletedListing });
    } catch (error) {
      console.error('Error deleting listing:', error);
      res.status(500).json({ 
        message: "Failed to delete listing",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Bookmarks endpoints
  app.post("/api/bookmarks", requireAuth, async (req, res) => {
    try {
      const { listingId } = req.body;

      // Check if bookmark already exists
      const [existingBookmark] = await db
        .select()
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, req.user.id),
            eq(bookmarks.listingId, listingId)
          )
        )
        .limit(1);

      if (existingBookmark) {
        return res.status(400).json({ message: "Already bookmarked" });
      }

      const [bookmark] = await db
        .insert(bookmarks)
        .values({
          userId: req.user.id,
          listingId: listingId,
        })
        .returning();

      res.json(bookmark);
    } catch (error) {
      console.error('Error creating bookmark:', error);
      res.status(500).json({ 
        message: "Failed to create bookmark",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.delete("/api/bookmarks/:listingId", requireAuth, async (req, res) => {
    try {
      await db
        .delete(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, req.user.id),
            eq(bookmarks.listingId, parseInt(req.params.listingId))
          )
        );

      res.json({ message: "Bookmark removed" });
    } catch (error) {
      console.error('Error removing bookmark:', error);
      res.status(500).json({ 
        message: "Failed to remove bookmark",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/bookmarks", requireAuth, async (req, res) => {
    try {
      const bookmarkedListings = await db
        .select({
          listing: listings,
          bookmarkId: bookmarks.id,
        })
        .from(bookmarks)
        .innerJoin(listings, eq(listings.id, bookmarks.listingId))
        .where(eq(bookmarks.userId, req.user.id));

      res.json(bookmarkedListings.map(({ listing, bookmarkId }) => ({
        ...listing,
        bookmarkId,
      })));
    } catch (error) {
      console.error('Error fetching bookmarks:', error);
      res.status(500).json({ 
        message: "Failed to fetch bookmarks",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Messages endpoints
  app.get("/api/messages/unread", requireAuth, async (req, res) => {
    try {
      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(messages)
        .where(
          and(
            eq(messages.recipientId, req.user.id),
            sql`read_at IS NULL`
          )
        );

      res.json(result[0]?.count || 0);
    } catch (error) {
      console.error('Error fetching unread count:', error);
      res.status(500).json({ 
        message: "Failed to fetch unread count",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/messages/:id/read", requireAuth, async (req, res) => {
    try {
      const [message] = await db
        .update(messages)
        .set({
          readAt: new Date()
        })
        .where(
          and(
            eq(messages.id, parseInt(req.params.id)),
            eq(messages.recipientId, req.user.id)
          )
        )
        .returning();

      res.json(message);
    } catch (error) {
      console.error('Error marking message as read:', error);
      res.status(500).json({ 
        message: "Failed to mark message as read",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/api/messages", requireAuth, async (req, res) => {
    try {
      const { recipientId, listingId, content, replyToId } = req.body;

      if (!content?.trim()) {
        return res.status(400).json({ message: "Message content is required" });
      }

      if (!recipientId || !listingId) {
        return res.status(400).json({ message: "Invalid conversation details" });
      }

      // Verify that the listing exists and is active
      const [listing] = await db
        .select()
        .from(listings)
        .where(eq(listings.id, listingId))
        .limit(1);

      if (!listing) {
        return res.status(404).json({ 
          message: "Listing not found or has been removed" 
        });
      }

      if (listing.status !== 'active') {
        return res.status(400).json({ 
          message: "Cannot send message: Listing is no longer active" 
        });
      }

      // Verify that the recipient exists
      const [recipient] = await db
        .select()
        .from(users)
        .where(eq(users.id, recipientId))
        .limit(1);

      if (!recipient) {
        return res.status(404).json({ message: "Recipient not found" });
      }

      // If replyToId is provided, verify it exists and belongs to the same conversation
      if (replyToId) {
        const [originalMessage] = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.id, replyToId),
              eq(messages.listingId, listingId)
            )
          )
          .limit(1);

        if (!originalMessage) {
          return res.status(404).json({ message: "Original message not found" });
        }
      }

      const [message] = await db
        .insert(messages)
        .values({
          senderId: req.user.id,
          recipientId: recipientId,
          listingId: listingId,
          content: content.trim(),
          replyToId: replyToId || null
        })
        .returning();

      res.json(message);
    } catch (error) {
      console.error('Error creating message:', error);
      res.status(500).json({ 
        message: "Failed to send message",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/messages", requireAuth, async (req, res) => {
    try {
      const userMessages = await db
        .select()
        .from(messages)
        .where(
          or(
            eq(messages.senderId, req.user.id),
            eq(messages.recipientId, req.user.id)
          )
        )
        .orderBy(messages.createdAt);

      res.json(userMessages);
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({ 
        message: "Failed to fetch messages",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/messages/:listingId", requireAuth, async (req, res) => {
    try {
      const { listingId } = req.params;

      const [listing] = await db
        .select()
        .from(listings)
        .where(eq(listings.id, parseInt(listingId)))
        .limit(1);

      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
      }

      // Only allow the seller and people who have sent messages to view the messages
      const userMessages = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.listingId, parseInt(listingId)),
            or(
              eq(messages.senderId, req.user.id),
              eq(messages.recipientId, req.user.id)
            )
          )
        )
        .orderBy(messages.createdAt);

      res.json(userMessages);
    } catch (error) {
      console.error('Error fetching listing messages:', error);
      res.status(500).json({ 
        message: "Failed to fetch messages",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return app;
}