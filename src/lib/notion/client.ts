const WORKER_ENDPOINT = "https://agi-gamerblog.jaredagini22.workers.dev";

// 投稿一覧
export async function getPosts(limit: number) {
  const res = await fetch(`${WORKER_ENDPOINT}/posts?limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch posts");
  return res.json();
}

// ランキング投稿（とりあえず最新 5 件などにする）
export async function getRankedPosts() {
  const res = await fetch(`${WORKER_ENDPOINT}/posts?limit=5`);
  if (!res.ok) throw new Error("Failed to fetch ranked posts");
  return res.json();
}

// タグ一覧（Cloudflare Worker 側で tags API が無いなら後で作る）
export async function getAllTags() {
  const res = await fetch(`${WORKER_ENDPOINT}/tags`);
  if (!res.ok) return [];
  return res.json();
}

// ページ数
export async function getNumberOfPages() {
  const res = await fetch(`${WORKER_ENDPOINT}/posts/count`);
  if (!res.ok) return 1;

  const count = await res.json();
  return Math.ceil(count / 10);
}

// 個別記事
export async function getPost(id: string) {
  const res = await fetch(`${WORKER_ENDPOINT}/post?id=${id}`);
  if (!res.ok) throw new Error("Failed to fetch post");
  return res.json();
}

// ブロック
export async function getBlocks(id: string) {
  const res = await fetch(`${WORKER_ENDPOINT}/blocks?id=${id}`);
  if (!res.ok) throw new Error("Failed to fetch blocks");
  return res.json();
}
