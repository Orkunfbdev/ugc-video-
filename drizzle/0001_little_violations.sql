ALTER TABLE `jobs` ADD `kind` text DEFAULT 'talking' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `duration` integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `scene_plan` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `scene_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `scene_video_urls` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `creator_image_url` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `voiceover` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `audio_url` text;