import type { Logger } from 'winston';

/**
 * @private
 * Internal node class used by LRU policy. Should not be used outside of tests.
 */
export class Node {
  prev: Node | null;

  next: Node | null;

  key: string;

  constructor(key: string, prev: Node | null = null, next: Node | null = null) {
    this.key = key;
    this.prev = prev;
    this.next = next;
  }
}

export class LinkedList {
  private _mostRecentlyUsed: Node | null = null;

  private _leastRecentlyUsed: Node | null = null;

  private _nodeMap: Map<string, Node> = new Map();

  private _logger: Logger;

  constructor(logger: Logger) {
    this._logger = logger;
  }

  get mostRecentlyUsed(): Node | null {
    return this._mostRecentlyUsed;
  }

  get leastRecentlyUsed(): Node | null {
    return this._leastRecentlyUsed;
  }

  get nodeMap(): Map<string, Node> {
    return this._nodeMap;
  }

  /**
   * Tracks a new node and sets it as the most recently used one.
   * @param {string} key - The hash key the node will use.
   * @returns {boolean} Whether the node has been added.
   */
  add(key: string): boolean {
    if (this._nodeMap.has(key)) return false;

    const node = new Node(key);

    this._logger.debug('Updating most recently used hash');
    if (this._mostRecentlyUsed !== null) {
      this._mostRecentlyUsed.next = node;
      node.prev = this._mostRecentlyUsed;
    }

    this._mostRecentlyUsed = node;
    if (this._leastRecentlyUsed === null) this._leastRecentlyUsed = node;

    this._nodeMap.set(key, node);
    return true;
  }

  /**
   * Removes the node with the given hash key from the linked list.
   * @param {string} key - The hash key of the node to remove.
   * @returns {boolean} Whether the node has been removed.
   */
  remove(key: string): boolean {
    const node = this._nodeMap.get(key);
    if (node === undefined) return false;

    this._logger.debug(`Removing hash ${key} and updating neighboring nodes`);
    if (this._leastRecentlyUsed?.key === node.key) this._leastRecentlyUsed = node.next;
    if (this._mostRecentlyUsed?.key === node.key) this._mostRecentlyUsed = node.prev;
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;

    this._nodeMap.delete(key);
    return true;
  }

  /**
   * Promotes a node to the most recently used node.
   * @param {string} key - The hash key of the node to promote.
   * @returns {boolean} Whether the node has been promoted.
   */
  promote(key: string): boolean {
    const node = this._nodeMap.get(key);
    if (node === undefined) return false;
    if (node.key === this._mostRecentlyUsed?.key) return false;

    this._logger.debug('Updating linked nodes');
    if (node.next !== null) node.next.prev = node.prev;
    if (node.prev !== null) node.prev.next = node.next;
    if (this._leastRecentlyUsed?.key === node.key) this._leastRecentlyUsed = node.next;

    this._logger.debug('Updating most recently used hash');
    if (this._mostRecentlyUsed !== null) {
      this._mostRecentlyUsed.next = node;
      node.prev = this._mostRecentlyUsed;
    }

    this._mostRecentlyUsed = node;
    this._mostRecentlyUsed.next = null;
    return true;
  }
}
