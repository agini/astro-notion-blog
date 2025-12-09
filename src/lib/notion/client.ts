import fs, { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import axios from 'axios';
import sharp from 'sharp';
import retry from 'async-retry';
import { Client, APIResponseError } from '@notionhq/client';
import ExifTransformer from 'exif-be-gone';

import {
  NOTION_API_SECRET,
  DATABASE_ID,
  NUMBER_OF_POSTS_PER_PAGE,
  REQUEST_TIMEOUT_MS,
} from '../../server-constants';

import type * as responses from './responses';
import type * as requestParams from './request-params';
import type {
  Database, Post, Block, Column, TableRow, TableCell, RichText, Annotation, FileObject, Emoji
} from '../interfaces';

// ----------------------
// Notion クライアント
// ----------------------
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const client = new Client({ auth: NOTION_API_SECRET, notionVersion: "2025-09-03" });

// ----------------------
// キャッシュ
// ----------------------
let postsCache: Post[] | null = null;
let dbCache: Database | null = null;
const numberOfRetry = 2;


// --- データベース取得 ---
export async function getDatabase(): Promise<Database> {
  if (dbCache) return dbCache;

  const res = await retry(async (bail) => {
    try {
      return await client.databases.retrieve({ database_id: DATABASE_ID } as any);
    } catch (err) {
      if (err instanceof APIResponseError && err.status >= 400 && err.status < 500) bail(err);
      throw err;
    }
  }, { retries: numberOfRetry }) as any;

  let cover: FileObject | null = res.cover
    ? {
        Type: res.cover.type,
        Url: res.cover.external?.url || res.cover.file?.url || "",
        ExpiryTime: res.cover.file?.expiry_time || null,
      }
    : null;

  let icon: FileObject | Emoji | null = null;
  if (res.icon) {
    if (res.icon.type === "emoji") icon = { Type: "emoji", Emoji: res.icon.emoji };
    else if (res.icon.type === "external") icon = { Type: "external", Url: res.icon.external?.url || "" };
    else if (res.icon.type === "file") icon = { Type: "file", Url: res.icon.file?.url || "" };
  }

  dbCache = {
    Title: res.title.map((r: any) => r.plain_text).join(""),
    Description: res.description.map((r: any) => r.plain_text).join(""),
    Icon: icon,
    Cover: cover,
  };

  return dbCache;
}
// ----------------------
// POSTS / DATABASE
// ----------------------
export async function getAllPosts(): Promise<Post[]> {
  if (postsCache) return postsCache;

  const db = await client.databases.retrieve({ database_id: DATABASE_ID }) as any;

  const filter = {
    and: [
      { property: 'Published', checkbox: { equals: true } },
      { property: 'Date', date: { on_or_before: new Date().toISOString() } },
    ],
  };

  const sorts = [{ property: 'Date', direction: 'descending' }];
  let results: responses.PageObject[] = [];
  let cursor: string | undefined = undefined;

  while (true) {
    const res = await retry(async (bail) => {
      try {
        return await client.databases.query({
          database_id: DATABASE_ID,
          filter,
          sorts,
          page_size: 100,
          start_cursor: cursor,
        } as any);
      } catch (err) {
        if (err instanceof APIResponseError && err.status >= 400 && err.status < 500) bail(err);
        throw err;
      }
    }, { retries: numberOfRetry });

    results = results.concat(res.results as any);
    if (!res.has_more || !res.next_cursor) break;
    cursor = res.next_cursor as string;
  }

  postsCache = results.filter(_validPageObject).map(_buildPost);
  return postsCache;
}

export async function getPostBySlug(slug: string) {
  return (await getAllPosts()).find(p => p.Slug === slug) || null;
}

// ----------------------
// BLOCKS / RECURSION
// ----------------------
export async function getAllBlocksByBlockId(blockId: string): Promise<Block[]> {
  let results: responses.BlockObject[] = [];

  if (fs.existsSync(`tmp/${blockId}.json`)) {
    results = JSON.parse(fs.readFileSync(`tmp/${blockId}.json`, 'utf-8'));
  } else {
    const params: requestParams.RetrieveBlockChildren = { block_id: blockId };
    while (true) {
      const res = await retry(async (bail) => {
        try {
          return await client.blocks.children.list(params as any);
        } catch (err) {
          if (err instanceof APIResponseError && err.status >= 400 && err.status < 500) bail(err);
          throw err;
        }
      }, { retries: numberOfRetry });

      results = results.concat(res.results as any);
      if (!res.has_more) break;
      params['start_cursor'] = res.next_cursor;
    }
  }

  const blocks = results.map(_buildBlockObject);

  for (const block of blocks) {
    if (block.HasChildren) {
      switch (block.Type) {
        case 'paragraph': block.Paragraph!.Children = await getAllBlocksByBlockId(block.Id); break;
        case 'heading_1': block.Heading1!.Children = await getAllBlocksByBlockId(block.Id); break;
        case 'heading_2': block.Heading2!.Children = await getAllBlocksByBlockId(block.Id); break;
        case 'heading_3': block.Heading3!.Children = await getAllBlocksByBlockId(block.Id); break;
        case 'bulleted_list_item': block.BulletedListItem!.Children = await getAllBlocksByBlockId(block.Id); break;
        case 'numbered_list_item': block.NumberedListItem!.Children = await getAllBlocksByBlockId(block.Id); break;
        case 'to_do': block.ToDo!.Children = await getAllBlocksByBlockId(block.Id); break;
        case 'toggle': block.Toggle!.Children = await getAllBlocksByBlockId(block.Id); break;
        case 'synced_block': block.SyncedBlock!.Children = await _getSyncedBlockChildren(block); break;
        case 'column_list': block.ColumnList!.Columns = await _getColumnsFromBlock(block.Id); break;
        case 'table': block.Table!.Rows = await _getTableRowsFromBlock(block.Id); break;
      }
    }
  }

  return blocks;
}

// 内部処理用
function _buildBlockObject(blockObject: responses.BlockObject): Block {
  const block: Block = { Id: blockObject.id, Type: blockObject.type, HasChildren: blockObject.has_children };
  // 必要に応じて block.type ごとの mapping を追加
  return block;
}

async function _getSyncedBlockChildren(block: Block): Promise<Block[]> {
  if (block.SyncedBlock?.SyncedFrom?.BlockId) {
    const original = await getAllBlocksByBlockId(block.SyncedBlock.SyncedFrom.BlockId);
    return original;
  }
  return [];
}

async function _getColumnsFromBlock(blockId: string): Promise<Column[]> {
  const children = await getAllBlocksByBlockId(blockId);
  return Promise.all(children.map(async col => ({ Blocks: await getAllBlocksByBlockId(col.Id) })));
}

async function _getTableRowsFromBlock(blockId: string): Promise<TableRow[]> {
  const rowBlocks = await getAllBlocksByBlockId(blockId);
  const rows: TableRow[] = [];

  for (const rowBlock of rowBlocks) {
    const cells: TableCell[] = [];
    for (const cell of rowBlock.TableRow?.Cells || []) {
      cells.push({ Blocks: await getAllBlocksByBlockId(cell.Id) });
    }
    rows.push({ Cells: cells });
  }

  return rows;
}

// ----------------------
// 画像処理
// ----------------------
export async function processNotionImage(url: string, savePath: string) {
  return downloadAndProcessImage(url, savePath);
}

// ----------------------
// HELPER
// ----------------------
function _validPageObject(pageObject: responses.PageObject) {
  const prop = pageObject.properties;
  return !!prop.Page.title?.length && !!prop.Slug.rich_text?.length && !!prop.Date.date;
}

function _buildPost(pageObject: responses.PageObject): Post {
  const prop = pageObject.properties;
  return {
    PageId: pageObject.id,
    Title: prop.Page.title?.map((r:any)=>r.plain_text).join('')||'',
    Slug: prop.Slug.rich_text?.map((r:any)=>r.plain_text).join('')||'',
    Date: prop.Date.date?.start||'',
    Tags: prop.Tags.multi_select||[],
    Icon: null,
    Cover: null,
    FeaturedImage: null,
    Rank: prop.Rank?.number || 0,
    Excerpt: prop.Excerpt?.rich_text?.map((r:any)=>r.plain_text).join('') || ''
  };
}
