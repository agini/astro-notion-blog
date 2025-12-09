// src/lib/notion/client.ts

const WORKER_ENDPOINT = "https://agi-gamerblog.jaredagini22.workers.dev";

export const notionClient = {
  async getPosts() {
    const res = await fetch(`${WORKER_ENDPOINT}/posts`);
    if (!res.ok) throw new Error("Failed to fetch posts");
    return res.json();
  },

  async getPost(id: string) {
    const res = await fetch(`${WORKER_ENDPOINT}/post?id=${id}`);
    if (!res.ok) throw new Error("Failed to fetch post");
    return res.json();
  },

  async getBlocks(id: string) {
    const res = await fetch(`${WORKER_ENDPOINT}/blocks?id=${id}`);
    if (!res.ok) throw new Error("Failed to fetch blocks");
    return res.json();
  }
};
