ALTER TABLE "thesis_versions" ADD COLUMN "excluded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "thesis_versions" ADD COLUMN "excluded_by" text;--> statement-breakpoint
CREATE INDEX "thesis_versions_owner_excluded_idx" ON "thesis_versions" USING btree ("owner_id","excluded_at","version_number");--> statement-breakpoint
UPDATE "thesis_versions" AS "version"
SET
	"excluded_at" = "extraction"."dismissed_at",
	"excluded_by" = "extraction"."dismissed_by",
	"superseded_at" = COALESCE("version"."superseded_at", "extraction"."dismissed_at")
FROM "external_thesis_extractions" AS "extraction"
WHERE
	"extraction"."confirmed_thesis_version_id" = "version"."id"
	AND "extraction"."dismissed_at" IS NOT NULL
	AND "version"."excluded_at" IS NULL;--> statement-breakpoint
UPDATE "external_thesis_extractions"
SET "result_json" = NULL, "error_message" = NULL
WHERE "dismissed_at" IS NOT NULL;--> statement-breakpoint
WITH "latest_remaining" AS (
	SELECT DISTINCT ON ("owner_id") "id", "owner_id"
	FROM "thesis_versions"
	WHERE "excluded_at" IS NULL
	ORDER BY "owner_id", "version_number" DESC
),
"owners_without_active" AS (
	SELECT "latest_remaining"."id"
	FROM "latest_remaining"
	WHERE NOT EXISTS (
		SELECT 1
		FROM "thesis_versions" AS "active"
		WHERE
			"active"."owner_id" = "latest_remaining"."owner_id"
			AND "active"."excluded_at" IS NULL
			AND "active"."superseded_at" IS NULL
	)
)
UPDATE "thesis_versions" AS "version"
SET "superseded_at" = NULL
FROM "owners_without_active"
WHERE "version"."id" = "owners_without_active"."id";
