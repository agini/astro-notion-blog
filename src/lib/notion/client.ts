const API_BASE = import.meta.env.PUBLIC_API_BASE_URL;

/**
 * 全ての投稿を取得
 */
export async function getAllPosts() {
  const res = await fetch(`${API_BASE}/posts`);
  const json = await res.json();
  return json.results || [];
}

/**
 * スラッグから投稿を取得
 */
export async function getPostBySlug(slug: string) {
  const res = await fetch(`${API_BASE}/post-by-slug/${slug}`);
  const json = await res.json();
  return json.post || null;
}

/**
 * 最新投稿〇件取得
 */
export async function getPosts(limit = 5) {
  const res = await fetch(`${API_BASE}/posts?limit=${limit}`);
  const json = await res.json();
  return json.results || [];
}

/**
 * 人気順（ランキング）投稿
 */
export async function getRankedPosts() {
  const res = await fetch(`${API_BASE}/posts/ranked`);
  const json = await res.json();
  return json.results || [];
}

/**
 * タグから投稿取得
 */
export async function getPostsByTag(tag: string, limit = 6) {
  if (!tag) return [];
  const res = await fetch(
    `${API_BASE}/posts-by-tag/${encodeURIComponent(tag)}?limit=${limit}`
  );
  const json = await res.json();
  return json.results || [];
}

/**
 * 全タグ取得
 */
export async function getAllTags() {
  const res = await fetch(`${API_BASE}/tags`);
  const json = await res.json();
  return json.tags || [];
}
