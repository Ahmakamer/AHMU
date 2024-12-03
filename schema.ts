const { pgTable, serial, text, timestamp, integer, boolean, jsonb } = require('drizzle-orm/pg-core');
const { createInsertSchema, createSelectSchema } = require('drizzle-zod');
const { z } = require('zod');

const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  username: text("username").unique().notNull(),
  password: text("password").notNull(),
  email: text("email").unique().notNull(),
  phone: text("phone").unique().notNull(),
  isAdmin: boolean("is_admin").default(false),
  isVerifiedSeller: boolean("is_verified_seller").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  profilePhoto: text("profile_photo"),
});

const categories = pgTable("categories", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  slug: text("slug").unique().notNull(),
});

const listings = pgTable("listings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  price: integer("price").notNull(),
  images: jsonb("images").$type<string[]>().default([]),
  categoryId: integer("category_id").references(() => categories.id),
  userId: integer("user_id").references(() => users.id),
  status: text("status").default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  location: text("location"),
  condition: text("condition"),
  brand: text("brand"),
  model: text("model"),
  subtype: text("subtype"),
  specifications: jsonb("specifications").$type<Record<string, string>>().default({}),
  phoneNumber: text("phone_number"),
  isPremium: boolean("is_premium").default(false),
  premiumTierId: integer("premium_tier_id").references(() => premiumTiers.id),
  premiumExpiresAt: timestamp("premium_expires_at"),
});

const sellerVerifications = pgTable("seller_verifications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").references(() => users.id).notNull(),
  documentImage: text("document_image").notNull(),
  status: text("status").default("pending"),
  rejectionReason: text("rejection_reason"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

const premiumTiers = pgTable("premium_tiers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  price: integer("price").notNull(),
  durationDays: integer("duration_days").notNull(),
  features: jsonb("features").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

const premiumPayments = pgTable("premium_payments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  listingId: integer("listing_id").references(() => listings.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  tierId: integer("tier_id").references(() => premiumTiers.id).notNull(),
  paymentProof: text("payment_proof").notNull(),
  status: text("status").default("pending"),
  amount: integer("amount").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
});

const listingViews = pgTable("listing_views", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  listingId: integer("listing_id").references(() => listings.id).notNull(),
  viewerId: integer("viewer_id").references(() => users.id),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent"),
  geoLocation: jsonb("geo_location").$type<{
    country?: string;
    city?: string;
    region?: string;
  }>(),
  sessionDuration: integer("session_duration"),
  viewStartTime: timestamp("view_start_time").defaultNow(),
  viewEndTime: timestamp("view_end_time"),
  isReturn: boolean("is_return").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

const bookmarks = pgTable("bookmarks", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").references(() => users.id).notNull(),
  listingId: integer("listing_id").references(() => listings.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

const messages = pgTable("messages", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  senderId: integer("sender_id").references(() => users.id),
  recipientId: integer("recipient_id").references(() => users.id),
  listingId: integer("listing_id").references(() => listings.id),
  content: text("content").notNull(),
  replyToId: integer("reply_to_id").references(() => messages.id),
  createdAt: timestamp("created_at").defaultNow(),
});

const insertUserSchema = createInsertSchema(users);
const selectUserSchema = createSelectSchema(users);
const User = z.infer<typeof selectUserSchema>;
const InsertUser = z.infer<typeof insertUserSchema>;

const insertListingSchema = createInsertSchema(listings);
const selectListingSchema = createSelectSchema(listings);
const Listing = z.infer<typeof selectListingSchema>;
const InsertListing = z.infer<typeof insertListingSchema>;

const insertBookmarkSchema = createInsertSchema(bookmarks);
const selectBookmarkSchema = createSelectSchema(bookmarks);
const Bookmark = z.infer<typeof selectBookmarkSchema>;
const InsertBookmark = z.infer<typeof insertBookmarkSchema>;

const insertMessageSchema = createInsertSchema(messages);
const selectMessageSchema = createSelectSchema(messages);
const Message = z.infer<typeof selectMessageSchema>;
const InsertMessage = z.infer<typeof insertMessageSchema>;

const insertListingViewSchema = createInsertSchema(listingViews);
const insertPremiumTierSchema = createInsertSchema(premiumTiers);
const selectPremiumTierSchema = createSelectSchema(premiumTiers);
const PremiumTier = z.infer<typeof selectPremiumTierSchema>;
const InsertPremiumTier = z.infer<typeof insertPremiumTierSchema>;
const selectListingViewSchema = createSelectSchema(listingViews);
const ListingView = z.infer<typeof selectListingViewSchema>;
const InsertListingView = z.infer<typeof insertListingViewSchema>;

const insertPremiumPaymentSchema = createInsertSchema(premiumPayments);
const selectPremiumPaymentSchema = createSelectSchema(premiumPayments);
const PremiumPayment = z.infer<typeof selectPremiumPaymentSchema>;
const InsertPremiumPayment = z.infer<typeof insertPremiumPaymentSchema>;

const insertSellerVerificationSchema = createInsertSchema(sellerVerifications);
const selectSellerVerificationSchema = createSelectSchema(sellerVerifications);
const SellerVerification = z.infer<typeof selectSellerVerificationSchema>;
const InsertSellerVerification = z.infer<typeof insertSellerVerificationSchema>;

module.exports = {
  users,
  categories,
  listings,
  sellerVerifications,
  premiumTiers,
  premiumPayments,
  listingViews,
  bookmarks,
  messages,
  insertUserSchema,
  selectUserSchema,
  User,
  InsertUser,
  insertListingSchema,
  selectListingSchema,
  Listing,
  InsertListing,
  insertBookmarkSchema,
  selectBookmarkSchema,
  Bookmark,
  InsertBookmark,
  insertMessageSchema,
  selectMessageSchema,
  Message,
  InsertMessage,
  insertListingViewSchema,
  insertPremiumTierSchema,
  selectPremiumTierSchema,
  PremiumTier,
  InsertPremiumTier,
  selectListingViewSchema,
  ListingView,
  InsertListingView,
  insertPremiumPaymentSchema,
  selectPremiumPaymentSchema,
  PremiumPayment,
  InsertPremiumPayment,
  insertSellerVerificationSchema,
  selectSellerVerificationSchema,
  SellerVerification,
  InsertSellerVerification,
};
