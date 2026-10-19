ALTER TABLE "product_embeddings" DROP CONSTRAINT "product_embeddings_image_id_product_images_id_fk";
--> statement-breakpoint
ALTER TABLE "product_embeddings" ADD CONSTRAINT "product_embeddings_image_id_product_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."product_images"("id") ON DELETE cascade ON UPDATE no action;