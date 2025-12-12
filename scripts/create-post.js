import fs from 'fs';
import path from 'path';

// Get the post title from command line arguments
const title = process.argv[2];
if (!title) {
  console.error('Error: Please provide a post title.');
  process.exit(1);
}

// Generate slug (replace spaces with hyphens, convert to lowercase)
const slug = title.toLowerCase().replace(/\s+/g, '-');

// Get current date in YYYY-MM-DD format
const date = new Date().toISOString().split('T')[0];

// Ensure the target directory exists
const dir = path.join('pages/posts');
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

// frontmatter + article template
const content = `---
title: "${title}"
date: "${date}"
slug: "${slug}"
notionCover: ""
tags: []
---

# ${title}

Write your article content here.
`;

// Define file path for the new post
const filePath = path.join(dir, `${slug}.astro`);

// Check if the file already exists
if (fs.existsSync(filePath)) {
  console.error(`Error: ${filePath} already exists.`);
  process.exit(1);
}

// Write the new post file
fs.writeFileSync(filePath, content);

console.log(`Created new post: ${filePath}`);
