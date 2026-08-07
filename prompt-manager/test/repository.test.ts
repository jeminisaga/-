import { describe, expect, it } from "vitest";
import { PromptRepository, escapeLike } from "../src/repository";
import { createTestDb, fixedClock, sequentialIds } from "./helpers/d1";

function repo(): PromptRepository {
  return new PromptRepository(createTestDb(), fixedClock(), sequentialIds());
}

async function seed(repository: PromptRepository) {
  const a = await repository.create({
    title: "X投稿のたたき台",
    content: "次のテーマでポストの案を3つ書いて",
    tags: "X投稿,分析",
  });
  const b = await repository.create({
    title: "議事録の要約",
    content: "以下の議事録を5行で要約して",
    tags: "要約,Claude",
  });
  const c = await repository.create({
    title: "コードレビュー",
    content: "この差分をレビューして",
    tags: null,
  });
  return { a, b, c };
}

describe("PromptRepository", () => {
  it("作成したプロンプトを ID で取得できる", async () => {
    const repository = repo();
    const created = await repository.create({
      title: "タイトル",
      content: "本文",
      tags: "tag1,tag2",
    });

    expect(created.id).toBe("id-1");
    expect(created.created_at).toBe(created.updated_at);

    const found = await repository.get(created.id);
    expect(found).toEqual(created);
  });

  it("存在しない ID は null を返す", async () => {
    expect(await repo().get("missing")).toBeNull();
  });

  it("一覧は新しい順に並ぶ", async () => {
    const repository = repo();
    const { a, b, c } = await seed(repository);

    const listed = await repository.list(50, 0);
    expect(listed.map((prompt) => prompt.id)).toEqual([c.id, b.id, a.id]);
  });

  it("limit と offset が効く", async () => {
    const repository = repo();
    const { b } = await seed(repository);

    const page = await repository.list(1, 1);
    expect(page.map((prompt) => prompt.id)).toEqual([b.id]);
  });

  it("更新は指定フィールドだけを変え、updated_at を進める", async () => {
    const repository = repo();
    const created = await repository.create({ title: "旧題", content: "本文", tags: "a" });

    const updated = await repository.update(created.id, { title: "新題" });

    expect(updated).not.toBeNull();
    expect(updated?.title).toBe("新題");
    expect(updated?.content).toBe("本文");
    expect(updated?.tags).toBe("a");
    expect(updated?.created_at).toBe(created.created_at);
    expect(updated?.updated_at).not.toBe(created.updated_at);

    // 永続化されていることを確認
    expect(await repository.get(created.id)).toEqual(updated);
  });

  it("存在しない ID の更新は null", async () => {
    expect(await repo().update("missing", { title: "x" })).toBeNull();
  });

  it("削除できたかを真偽値で返す", async () => {
    const repository = repo();
    const created = await repository.create({ title: "t", content: "c", tags: null });

    expect(await repository.delete(created.id)).toBe(true);
    expect(await repository.delete(created.id)).toBe(false);
    expect(await repository.get(created.id)).toBeNull();
  });

  describe("search", () => {
    it("キーワードは title / content / tags を横断する", async () => {
      const repository = repo();
      const { a, b, c } = await seed(repository);

      expect((await repository.search({ query: "議事録", limit: 50, offset: 0 })).map((p) => p.id))
        .toEqual([b.id]);
      expect((await repository.search({ query: "レビュー", limit: 50, offset: 0 })).map((p) => p.id))
        .toEqual([c.id]);
      expect((await repository.search({ query: "分析", limit: 50, offset: 0 })).map((p) => p.id))
        .toEqual([a.id]);
    });

    it("タグは完全一致（前方一致の別タグを拾わない）", async () => {
      const repository = repo();
      await repository.create({ title: "1", content: "c", tags: "分析" });
      await repository.create({ title: "2", content: "c", tags: "分析レポート" });

      const hits = await repository.search({ tag: "分析", limit: 50, offset: 0 });
      expect(hits.map((prompt) => prompt.title)).toEqual(["1"]);
    });

    it("タグ未設定のプロンプトはタグ検索に出てこない", async () => {
      const repository = repo();
      await repository.create({ title: "no tags", content: "c", tags: null });

      expect(await repository.search({ tag: "分析", limit: 50, offset: 0 })).toEqual([]);
    });

    it("キーワードとタグは AND 条件", async () => {
      const repository = repo();
      await repository.create({ title: "要約する", content: "c", tags: "Claude" });
      await repository.create({ title: "要約する", content: "c", tags: "Grok" });

      const hits = await repository.search({ query: "要約", tag: "Claude", limit: 50, offset: 0 });
      expect(hits).toHaveLength(1);
      expect(hits[0]?.tags).toBe("Claude");
    });

    it("LIKE のワイルドカードはリテラルとして扱う", async () => {
      const repository = repo();
      await repository.create({ title: "100%達成", content: "c", tags: null });
      await repository.create({ title: "その他", content: "c", tags: null });

      const hits = await repository.search({ query: "100%", limit: 50, offset: 0 });
      expect(hits.map((prompt) => prompt.title)).toEqual(["100%達成"]);

      // "_" が任意 1 文字として振る舞わないこと
      expect(await repository.search({ query: "そ_他", limit: 50, offset: 0 })).toEqual([]);
    });

    it("検索結果も新しい順", async () => {
      const repository = repo();
      const first = await repository.create({ title: "共通", content: "c", tags: null });
      const second = await repository.create({ title: "共通", content: "c", tags: null });

      const hits = await repository.search({ query: "共通", limit: 50, offset: 0 });
      expect(hits.map((prompt) => prompt.id)).toEqual([second.id, first.id]);
    });
  });
});

describe("escapeLike", () => {
  it("% _ \\ をエスケープする", () => {
    expect(escapeLike("100%_\\")).toBe("100\\%\\_\\\\");
  });
});
