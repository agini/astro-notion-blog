import type { APIRoute } from 'astro'
import { getAllPosts, getDatabase } from '@/lib/notion/client'

export const GET: APIRoute = async () => {
  const database = await getDatabase()
  const posts = await getAllPosts()

  return new Response(
    JSON.stringify({
      title: database.Title,
      posts: posts.filter(p => p.PageType === 'post'),
    }),
    {
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )
}
