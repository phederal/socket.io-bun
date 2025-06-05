import { describe, test, expect } from 'bun:test';
import { Encoder, Decoder, PacketType, isPacketValid } from '../../src/parser';

// Tests for Encoder and Decoder

describe('Parser API', () => {
  test('encode and decode simple event', () => {
    const encoder = new Encoder();
    const decoder = new Decoder();

    const packet = { type: PacketType.EVENT, nsp: '/', data: ['greet', 'hi'] };
    const encoded = encoder.encode(packet);
    let decoded: any = null;
    decoder.on('decoded', (pkt: any) => { decoded = pkt; });
    for (const chunk of encoded) {
      decoder.add(chunk);
    }
    expect(decoded).toEqual(packet);
  });

  test('isPacketValid utility', () => {
    const packet = { type: PacketType.EVENT, nsp: '/', data: ['ping'] };
    expect(isPacketValid(packet)).toBe(true);
  });
});
