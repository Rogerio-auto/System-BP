CREATE TABLE IF NOT EXISTS "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_city_scopes" (
	"user_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_city_scopes_user_id_city_id_pk" PRIMARY KEY("user_id","city_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_sessions_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_login_at" timestamp with time zone,
	"totp_secret" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_status_check" CHECK ("status" IN ('active', 'disabled', 'pending'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_permissions" ADD CONSTRAINT "fk_role_permissions_role" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_permissions" ADD CONSTRAINT "fk_role_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_city_scopes" ADD CONSTRAINT "fk_user_city_scopes_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_roles" ADD CONSTRAINT "fk_user_roles_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_roles" ADD CONSTRAINT "fk_user_roles_role" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_sessions" ADD CONSTRAINT "fk_user_sessions_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "fk_users_organization" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_permissions_key" ON "permissions" USING btree ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_role_permissions_permission" ON "role_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_roles_key" ON "roles" USING btree ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_city_scopes_city" ON "user_city_scopes" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_roles_role" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_sessions_user" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_sessions_active" ON "user_sessions" USING btree ("user_id","expires_at") WHERE "user_sessions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_org" ON "users" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_org_email_active" ON "users" USING btree ("organization_id","email") WHERE "users"."deleted_at" IS NULL;