
import { defineCollection, z } from 'astro:content';

const blogCollection = defineCollection({
	type: 'content',
	// Type-check frontmatter using a schema
	schema: z.object({
		title: z.string(),
		date: z.coerce.date(),
        author: z.string().default('Anonymous'),
		tags: z.array(z.string()),
		excerpt: z.string(),
        image: z.string().optional(),
	}),
});

export const collections = {
	'blog': blogCollection,
};
