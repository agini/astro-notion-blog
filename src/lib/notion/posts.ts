import { getAllPosts } from './client' // 実際の取得元に合わせる

export async function getPostList() {
  const posts = await getAllPosts()
  return posts.filter(p => p.PageType === 'post')
}

export async function getAllTags(): Promise<string[]> {
  const posts = await getPostList()

  return Array.from(
    new Set(
      posts.flatMap(p => p.Tags ?? [])
    )
  )
}
