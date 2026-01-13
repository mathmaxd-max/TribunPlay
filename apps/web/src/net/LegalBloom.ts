/**
 * Bloom Filter Validator for Legal Actions
 * 
 * Implements a Bloom filter to test if an action is probably legal.
 * The server sends a Bloom filter encoding the set of legal actions,
 * and the client uses it to quickly test candidate actions without
 * downloading the full move list.
 */

/**
 * Bloom filter parameters
 */
export interface BloomFilterParams {
  m: number; // Number of bits in the filter
  k: number; // Number of hash functions
  bitsB64: string; // Base64-encoded bit array
}

/**
 * Legal validator message from server
 */
export interface LegalValidatorMessage {
  t: 'legal';
  ply: number;
  bloom: BloomFilterParams;
}

/**
 * Bloom filter validator class
 */
export class LegalBloomValidator {
  private m: number;
  private k: number;
  private bits: Uint8Array;
  private ply: number;

  constructor(params: BloomFilterParams, ply: number) {
    this.m = params.m;
    this.k = params.k;
    this.ply = ply;
    
    // Decode base64 bit array
    const binary = atob(params.bitsB64);
    this.bits = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      this.bits[i] = binary.charCodeAt(i);
    }
  }

  /**
   * Test if an action is probably legal (may have false positives)
   */
  isProbablyLegal(action: number): boolean {
    // Hash the action k times and check all bits are set
    for (let i = 0; i < this.k; i++) {
      const hash = this.hash(action, i);
      const bitIndex = hash % this.m;
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = bitIndex % 8;
      
      if (byteIndex >= this.bits.length) {
        return false; // Out of bounds
      }
      
      const bit = (this.bits[byteIndex] >>> bitOffset) & 1;
      if (bit === 0) {
        return false; // At least one bit not set
      }
    }
    
    return true; // All bits set (probably legal, but may be false positive)
  }

  /**
   * Get the ply this validator is for
   */
  getPly(): number {
    return this.ply;
  }

  /**
   * Hash function for Bloom filter
   * Uses FNV-1a hash with seed variation for multiple hash functions
   */
  private hash(value: number, seed: number): number {
    // FNV-1a hash
    let hash = 2166136261 ^ (seed * 16777619);
    hash ^= (value >>> 24) & 0xff;
    hash = (hash * 16777619) >>> 0;
    hash ^= (value >>> 16) & 0xff;
    hash = (hash * 16777619) >>> 0;
    hash ^= (value >>> 8) & 0xff;
    hash = (hash * 16777619) >>> 0;
    hash ^= value & 0xff;
    hash = (hash * 16777619) >>> 0;
    
    return hash >>> 0; // Ensure unsigned 32-bit
  }
}

/**
 * Create a Bloom filter from a set of legal actions
 * (Used on server side)
 */
export function createBloomFilter(
  legalActions: number[],
  m: number = Math.max(1024, legalActions.length * 8), // Default: 8 bits per action
  k: number = 3 // Default: 3 hash functions
): BloomFilterParams {
  const bits = new Uint8Array(Math.ceil(m / 8));
  
  // Add each legal action to the filter
  for (const action of legalActions) {
    for (let i = 0; i < k; i++) {
      const hash = hashAction(action, i);
      const bitIndex = hash % m;
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = bitIndex % 8;
      
      if (byteIndex < bits.length) {
        bits[byteIndex] |= (1 << bitOffset);
      }
    }
  }
  
  // Encode to base64
  const binary = String.fromCharCode(...bits);
  const bitsB64 = btoa(binary);
  
  return { m, k, bitsB64 };
}

/**
 * Hash function for creating Bloom filter
 */
function hashAction(value: number, seed: number): number {
  let hash = 2166136261 ^ (seed * 16777619);
  hash ^= (value >>> 24) & 0xff;
  hash = (hash * 16777619) >>> 0;
  hash ^= (value >>> 16) & 0xff;
  hash = (hash * 16777619) >>> 0;
  hash ^= (value >>> 8) & 0xff;
  hash = (hash * 16777619) >>> 0;
  hash ^= value & 0xff;
  hash = (hash * 16777619) >>> 0;
  return hash >>> 0;
}
