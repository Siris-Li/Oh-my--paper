import * as Y from "yjs";
import type { ReviewComment, ReviewReply } from "../../types";

export class CommentStore {
  private yArray: Y.Array<ReviewComment>;
  private yDoc: Y.Doc;

  constructor(yDoc: Y.Doc) {
    this.yDoc = yDoc;
    this.yArray = yDoc.getArray<ReviewComment>("comments");
  }

  getComments(): ReviewComment[] {
    return this.yArray.toJSON() as ReviewComment[];
  }

  addComment(params: {
    userId: string;
    userName: string;
    userColor: string;
    filePath: string;
    lineStart: number;
    lineEnd: number;
    text: string;
  }): string {
    const id = crypto.randomUUID();
    const comment: ReviewComment = {
      id,
      userId: params.userId,
      userName: params.userName,
      userColor: params.userColor,
      filePath: params.filePath,
      lineStart: params.lineStart,
      lineEnd: params.lineEnd,
      text: params.text,
      timestamp: new Date().toISOString(),
      resolved: false,
      replies: [],
    };
    this.yArray.push([comment]);
    return id;
  }

  resolveComment(id: string): void {
    this.yDoc.transact(() => {
      const items = this.yArray.toJSON() as ReviewComment[];
      const index = items.findIndex((c) => c.id === id);
      if (index < 0) return;
      const updated = { ...items[index], resolved: !items[index].resolved };
      this.yArray.delete(index, 1);
      this.yArray.insert(index, [updated]);
    });
  }

  addReply(commentId: string, reply: Omit<ReviewReply, "id">): void {
    this.yDoc.transact(() => {
      const items = this.yArray.toJSON() as ReviewComment[];
      const index = items.findIndex((c) => c.id === commentId);
      if (index < 0) return;
      const newReply: ReviewReply = { id: crypto.randomUUID(), ...reply };
      const updated = { ...items[index], replies: [...items[index].replies, newReply] };
      this.yArray.delete(index, 1);
      this.yArray.insert(index, [updated]);
    });
  }

  deleteComment(id: string): void {
    this.yDoc.transact(() => {
      const items = this.yArray.toJSON() as ReviewComment[];
      const index = items.findIndex((c) => c.id === id);
      if (index < 0) return;
      this.yArray.delete(index, 1);
    });
  }

  subscribe(cb: () => void): () => void {
    const handler = () => cb();
    this.yArray.observe(handler);
    return () => this.yArray.unobserve(handler);
  }
}
