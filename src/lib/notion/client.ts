import fs, { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import axios from 'axios'
import sharp from 'sharp'
import retry from 'async-retry'
import { Client, APIResponseError } from '@notionhq/client'
import ExifTransformer from 'exif-be-gone'


import {
  NOTION_API_SECRET,
  DATABASE_ID,
  NUMBER_OF_POSTS_PER_PAGE,
  REQUEST_TIMEOUT_MS,
} from '../../server-constants'

import type { AxiosResponse } from 'axios'
import type * as responses from './responses'
import type * as requestParams from './request-params'
import type {
  Database,
  Post,
  Block,
  Paragraph,
  Heading1,
  Heading2,
  Heading3,
  BulletedListItem,
  NumberedListItem,
  ToDo,
  Image,
  Code,
  Quote,
  Equation,
  Callout,
  Embed,
  Video,
  File,
  Bookmark,
  LinkPreview,
  SyncedBlock,
  SyncedFrom,
  Table,
  TableRow,
  TableCell,
  Toggle,
  ColumnList,
  Column,
  TableOfContents,
  RichText,
  Text,
  Annotation,
  SelectProperty,
  Emoji,
  FileObject,
  LinkToPage,
  Mention,
  Reference,
} from '../interfaces'

import { Client } from "@notionhq/client";
import type { PageObjectResponse, PartialBlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { downloadAndProcessImage } from "./notionImages"; // 画像処理関数を別ファイルで管理

// Notionクライアント初期化
const notion = new Client({ auth: process.env.NOTION_API_KEY });

// --- Notion API 2025 ---
const client = new Client({
  auth: NOTION_API_SECRET,
  notionVersion: "2025-09-03",
})

let postsCache: Post[] | null = null
let dbCache: Database | null = null
const numberOfRetry = 2

// --- Posts --- 
export async function getAllPosts(): Promise<Post[]> {
  if (postsCache) return postsCache

  const db = await client.databases.retrieve({ database_id: DATABASE_ID }) as any
  const dataSourceId = db.data_sources?.[0]?.id ?? db.parent?.data_source_id ?? null
  if (!dataSourceId) throw new Error(`❌ No data_source_id found for database: ${DATABASE_ID}`)

  const filter = {
    and: [
      { property: 'Published', checkbox: { equals: true } },
      { property: 'Date', date: { on_or_before: new Date().toISOString() } },
    ],
  }

  const sorts = [{ property: 'Date', direction: 'descending' }]
  let results: responses.PageObject[] = []
  let cursor: string | undefined = undefined

  while (true) {
    const res = await retry(async (bail) => {
      try {
        return await client.databases.query({
          database_id: DATABASE_ID,
          filter,
          sorts,
          page_size: 100,
          start_cursor: cursor,
        } as any)
      } catch (err) {
        if (err instanceof APIResponseError && err.status >= 400 && err.status < 500) bail(err)
        throw err
      }
    }, { retries: numberOfRetry })

    results = results.concat(res.results as any)

    if (!res.has_more || !res.next_cursor) break
    cursor = res.next_cursor as string
  }

  postsCache = results.filter(_validPageObject).map(_buildPost)
  return postsCache
}

// --- ページ取得系 --- 
export async function getPosts(pageSize = 10) {
  return (await getAllPosts()).slice(0, pageSize)
}

export async function getRankedPosts(pageSize = 10) {
  return (await getAllPosts())
    .filter(post => !!post.Rank)
    .sort((a, b) => (b.Rank || 0) - (a.Rank || 0))
    .slice(0, pageSize)
}

export async function getPostBySlug(slug: string) {
  return (await getAllPosts()).find(p => p.Slug === slug) || null
}

export async function getPostByPageId(pageId: string) {
  return (await getAllPosts()).find(p => p.PageId === pageId) || null
}

export async function getPostsByTag(tagName: string, pageSize = 10) {
  if (!tagName) return []
  return (await getAllPosts())
    .filter(post => post.Tags.some(tag => tag.name === tagName))
    .slice(0, pageSize)
}

// --- ページング --- 
export async function getPostsByPage(page: number) {
  if (page < 1) return []
  const allPosts = await getAllPosts()
  const start = (page - 1) * NUMBER_OF_POSTS_PER_PAGE
  return allPosts.slice(start, start + NUMBER_OF_POSTS_PER_PAGE)
}

export async function getPostsByTagAndPage(tagName: string, page: number) {
  if (page < 1) return []
  const posts = (await getAllPosts()).filter(post => post.Tags.some(tag => tag.name === tagName))
  const start = (page - 1) * NUMBER_OF_POSTS_PER_PAGE
  return posts.slice(start, start + NUMBER_OF_POSTS_PER_PAGE)
}

export async function getNumberOfPages() {
  const total = (await getAllPosts()).length
  return Math.ceil(total / NUMBER_OF_POSTS_PER_PAGE)
}

export async function getNumberOfPagesByTag(tagName: string) {
  const total = (await getAllPosts()).filter(post => post.Tags.some(tag => tag.name === tagName)).length
  return Math.ceil(total / NUMBER_OF_POSTS_PER_PAGE)
}

// --- Blocks --- 
export async function getAllBlocksByBlockId(blockId: string): Promise<Block[]> {
  let results: responses.BlockObject[] = []

  if (fs.existsSync(`tmp/${blockId}.json`)) {
    results = JSON.parse(fs.readFileSync(`tmp/${blockId}.json`, 'utf-8'))
  } else {
    const params: requestParams.RetrieveBlockChildren = { block_id: blockId }
    while (true) {
      const res = await retry(async (bail) => {
        try {
          return await client.blocks.children.list(params as any)
        } catch (err) {
          if (err instanceof APIResponseError && err.status >= 400 && err.status < 500) bail(err)
          throw err
        }
      }, { retries: numberOfRetry })

      results = results.concat(res.results as any)
      if (!res.has_more) break
      params['start_cursor'] = res.next_cursor
    }
  }

  const blocks = results.map(_buildBlock)

  for (const block of blocks) {
    if (block.HasChildren) {
      switch (block.Type) {
        case 'paragraph': block.Paragraph!.Children = await getAllBlocksByBlockId(block.Id); break
        case 'heading_1': block.Heading1!.Children = await getAllBlocksByBlockId(block.Id); break
        case 'heading_2': block.Heading2!.Children = await getAllBlocksByBlockId(block.Id); break
        case 'heading_3': block.Heading3!.Children = await getAllBlocksByBlockId(block.Id); break
        case 'bulleted_list_item': block.BulletedListItem!.Children = await getAllBlocksByBlockId(block.Id); break
        case 'numbered_list_item': block.NumberedListItem!.Children = await getAllBlocksByBlockId(block.Id); break
        case 'to_do': block.ToDo!.Children = await getAllBlocksByBlockId(block.Id); break
        case 'toggle': block.Toggle!.Children = await getAllBlocksByBlockId(block.Id); break
        case 'synced_block': block.SyncedBlock!.Children = await _getSyncedBlockChildren(block); break
        case 'column_list': block.ColumnList!.Columns = await _getColumns(block.Id); break
        case 'table': block.Table!.Rows = await _getTableRows(block.Id); break
      }
    }
  }

  return blocks
}

export async function getBlock(blockId: string) {
  const res = await retry(async (bail) => {
    try {
      return await client.blocks.retrieve({ block_id: blockId } as any)
    } catch (err) {
      if (err instanceof APIResponseError && err.status >= 400 && err.status < 500) bail(err)
      throw err
    }
  }, { retries: numberOfRetry })

  return _buildBlock(res as responses.BlockObject)
}

// --- Database --- 
export async function getDatabase(): Promise<Database> {
  if (dbCache) return dbCache
  const res = await retry(async (bail) => {
    try {
      return await client.databases.retrieve({ database_id: DATABASE_ID } as any)
    } catch (err) {
      if (err instanceof APIResponseError && err.status >= 400 && err.status < 500) bail(err)
      throw err
    }
  }, { retries: numberOfRetry }) as any

  const cover: FileObject | null = res.cover ? {
    Type: res.cover.type,
    Url: res.cover.external?.url || res.cover.file?.url || '',
    ExpiryTime: res.cover.file?.expiry_time || null
  } : null

  let icon: FileObject | Emoji | null = null
  if (res.icon) {
    if (res.icon.type === 'emoji') icon = { Type: 'emoji', Emoji: res.icon.emoji }
    else if (res.icon.type === 'external') icon = { Type: 'external', Url: res.icon.external?.url || '' }
    else if (res.icon.type === 'file') icon = { Type: 'file', Url: res.icon.file?.url || '' }
  }

  dbCache = {
    Title: res.title.map((r: any) => r.plain_text).join(''),
    Description: res.description.map((r: any) => r.plain_text).join(''),
    Icon: icon,
    Cover: cover
  }

  return dbCache
}

// --- Download files --- 
export async function downloadFile(url: URL) {
  let res!: AxiosResponse
  try {
    res = await axios.get(url.toString(), { timeout: REQUEST_TIMEOUT_MS, responseType: 'stream' })
  } catch { return }

  if (res.status !== 200) return

  const dir = './public/notion/' + url.pathname.split('/').slice(-2)[0]
  if (!fs.existsSync(dir)) fs.mkdirSync(dir)

  const filename = decodeURIComponent(url.pathname.split('/').slice(-1)[0])
  const filepath = `${dir}/${filename}`

  const writeStream = createWriteStream(filepath)
  let stream = res.data
  if (res.headers['content-type'] === 'image/jpeg') stream = stream.pipe(sharp().rotate())

  try { await pipeline(stream, new ExifTransformer(), writeStream) }
  catch { writeStream.end() }
}

// --- 内部ヘルパー --- 
function _validPageObject(pageObject: responses.PageObject) {
  const prop = pageObject.properties
  return !!prop.Page.title?.length && !!prop.Slug.rich_text?.length && !!prop.Date.date
}

function _buildPost(pageObject: responses.PageObject): Post {
  const prop = pageObject.properties
  let cover: FileObject | null = pageObject.cover ? {
    Type: pageObject.cover.type,
    Url: pageObject.cover.external?.url || pageObject.cover.file?.url || '',
    ExpiryTime: pageObject.cover.file?.expiry_time || null
  } : null

  let icon: FileObject | Emoji | null = null
  if (pageObject.icon) {
    if (pageObject.icon.type === 'emoji') icon = { Type: 'emoji', Emoji: pageObject.icon.emoji }
    else if (pageObject.icon.type === 'external') icon = { Type: 'external', Url: pageObject.icon.external?.url || '' }
    else if (pageObject.icon.type === 'file') icon = { Type: 'file', Url: pageObject.icon.file?.url || '', ExpiryTime: pageObject.icon.file?.expiry_time || null }
  }

  let featuredImage: FileObject | null = prop.FeaturedImage?.files?.[0] ? {
    Type: prop.FeaturedImage.files[0].type,
    Url: prop.FeaturedImage.files[0].external?.url || prop.FeaturedImage.files[0].file?.url || '',
    ExpiryTime: prop.FeaturedImage.files[0].file?.expiry_time || null
  } : cover

  return {
    PageId: pageObject.id,
    Title: prop.Page.title?.map((r:any)=>r.plain_text).join('')||'',
    Icon: icon,
    Cover: cover,
    Slug: prop.Slug.rich_text?.map((r:any)=>r.plain_text).join('')||'',
    Date: prop.Date.date?.start||'',
    Tags: prop.Tags.multi_select||[],
    Excerpt: prop.Excerpt.rich_text?.map((r:any)=>r.plain_text).join('')||'',
    FeaturedImage: featuredImage,
    Rank: prop.Rank?.number||0
  }
}

function _buildRichText(r: responses.RichTextObject): RichText {
  const annotation: Annotation = {
    Bold: r.annotations.bold,
    Italic: r.annotations.italic,
    Strikethrough: r.annotations.strikethrough,
    Underline: r.annotations.underline,
    Code: r.annotations.code,
    Color: r.annotations.color
  }

  const richText: RichText = { Annotation: annotation, PlainText: r.plain_text, Href: r.href }

  if (r.type === 'text' && r.text) {
    richText.Text = { Content: r.text.content, Link: r.text.link ? { Url: r.text.link.url } : undefined }
  } else if (r.type === 'equation' && r.equation) {
    richText.Equation = { Expression: r.equation.expression }
  } else if (r.type === 'mention' && r.mention) {
    richText.Mention = { Type: r.mention.type, Page: r.mention.page ? { Id: r.mention.page.id } : undefined }
  }

  return richText
}

function _buildBlock(blockObject: responses.BlockObject): Block {
  const block: Block = { Id: blockObject.id, Type: blockObject.type, HasChildren: blockObject.has_children }
  // ... ここも全て block.type ごとの mapping を 2025 API に対応して記述
  return block
}

async function _getSyncedBlockChildren(block: Block): Promise<Block[]> {
  if (block.SyncedBlock?.SyncedFrom?.BlockId) {
    const original = await getBlock(block.SyncedBlock.SyncedFrom.BlockId)
    return await getAllBlocksByBlockId(original.Id)
  }
  return []
}

async function _getColumns(blockId: string): Promise<Column[]> { /* ... */ return [] }
async function _getTableRows(blockId: string): Promise<TableRow[]> { /* ... */ return [] }

// --- _buildBlock ---
function _buildBlock(blockObject: responses.BlockObject): Block {
  const block: Block = { Id: blockObject.id, Type: blockObject.type, HasChildren: blockObject.has_children }

  switch (blockObject.type) {
    case 'paragraph':
      block.Paragraph = {
        RichTexts: blockObject.paragraph.rich_text.map(_buildRichText),
        Children: []
      }
      break
    case 'heading_1':
      block.Heading1 = { RichTexts: blockObject.heading_1.rich_text.map(_buildRichText), Children: [] }
      break
    case 'heading_2':
      block.Heading2 = { RichTexts: blockObject.heading_2.rich_text.map(_buildRichText), Children: [] }
      break
    case 'heading_3':
      block.Heading3 = { RichTexts: blockObject.heading_3.rich_text.map(_buildRichText), Children: [] }
      break
    case 'bulleted_list_item':
      block.BulletedListItem = { RichTexts: blockObject.bulleted_list_item.rich_text.map(_buildRichText), Children: [] }
      break
    case 'numbered_list_item':
      block.NumberedListItem = { RichTexts: blockObject.numbered_list_item.rich_text.map(_buildRichText), Children: [] }
      break
    case 'to_do':
      block.ToDo = {
        RichTexts: blockObject.to_do.rich_text.map(_buildRichText),
        Checked: blockObject.to_do.checked,
        Children: []
      }
      break
    case 'toggle':
      block.Toggle = { RichTexts: blockObject.toggle.rich_text.map(_buildRichText), Children: [] }
      break
    case 'synced_block':
      block.SyncedBlock = {
        Children: [],
        SyncedFrom: blockObject.synced_block.synced_from ? { BlockId: blockObject.synced_block.synced_from.block_id } : null
      }
      break
    case 'column_list':
      block.ColumnList = { Columns: [] }
      break
    case 'table':
      block.Table = { Rows: [] }
      break
    case 'image':
      block.Image = {
        Type: blockObject.image.type,
        Url: blockObject.image.external?.url || blockObject.image.file?.url || '',
        Caption: blockObject.image.caption.map(_buildRichText)
      }
      break
    case 'code':
      block.Code = {
        RichTexts: blockObject.code.rich_text.map(_buildRichText),
        Language: blockObject.code.language
      }
      break
    case 'quote':
      block.Quote = { RichTexts: blockObject.quote.rich_text.map(_buildRichText) }
      break
    case 'callout':
      block.Callout = {
        RichTexts: blockObject.callout.rich_text.map(_buildRichText),
        Icon: blockObject.callout.icon?.type === 'emoji' ? { Emoji: blockObject.callout.icon.emoji } : undefined
      }
      break
    case 'embed':
      block.Embed = { Url: blockObject.embed.url }
      break
    case 'video':
      block.Video = { Url: blockObject.video.external?.url || blockObject.video.file?.url || '' }
      break
    case 'file':
      block.File = { Url: blockObject.file.external?.url || blockObject.file.file?.url || '' }
      break
    case 'bookmark':
      block.Bookmark = { Url: blockObject.bookmark.url }
      break
    case 'link_preview':
      block.LinkPreview = { Url: blockObject.link_preview.url }
      break
    case 'table_of_contents':
      block.TableOfContents = {}
      break
    default:
      break
  }

  return block
}

// --- _getColumns ---
async function _getColumns(blockId: string): Promise<Column[]> {
  const children = await getAllBlocksByBlockId(blockId)
  const columns: Column[] = []
  for (const col of children) {
    columns.push({ Blocks: await getAllBlocksByBlockId(col.Id) })
  }
  return columns
}

// --- _getTableRows ---
async function _getTableRows(blockId: string): Promise<TableRow[]> {
  const rowsBlocks = await getAllBlocksByBlockId(blockId)
  const rows: TableRow[] = []
  for (const rowBlock of rowsBlocks) {
    const cells: TableCell[] = []
    for (const cell of rowBlock.TableRow?.Cells || []) {
      cells.push({ Blocks: await getAllBlocksByBlockId(cell.Id) })
    }
    rows.push({ Cells: cells })
  }
  return rows
}

/**
 * ブロックを取得
 * @param blockId NotionブロックID
 */
export async function _buildBlock(blockId: string): Promise<PartialBlockObjectResponse[]> {
  const res = await notion.blocks.children.list({ block_id: blockId });
  return res.results;
}

/**
 * データベースのカラムを取得
 * @param databaseId NotionデータベースID
 */
export async function _getColumns(databaseId: string) {
  const res = await notion.databases.retrieve({ database_id: databaseId });
  return res.properties;
}

/**
 * データベースの行を取得
 * @param databaseId NotionデータベースID
 */
export async function _getTableRows(databaseId: string) {
  const res = await notion.databases.query({ database_id: databaseId });
  return res.results as PageObjectResponse[];
}

// ----- 画像処理関数 -----

/**
 * 画像をダウンロードしてリサイズ・EXIF除去
 * @param url 画像URL
 * @param savePath 保存先パス
 */
export async function processNotionImage(url: string, savePath: string) {
  return downloadAndProcessImage(url, savePath);
}
