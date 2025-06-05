import { describe, test, expect } from 'bun:test';
import { Server } from '../../src/server';

// Basic tests for Server API based on llm.md

describe('Server API', () => {
  test('path getter and setter', () => {
    const io = new Server();
    expect(io.path()).toBe('/ws');
    io.path('/custom');
    expect(io.path()).toBe('/custom');
  });

  test('connectTimeout getter and setter', () => {
    const io = new Server();
    expect(typeof io.connectTimeout()).toBe('number');
    io.connectTimeout(3000);
    expect(io.connectTimeout()).toBe(3000);
  });

  test('adapter getter and setter', () => {
    const io = new Server();
    const current = io.adapter();
    expect(current).toBeDefined();
    io.adapter(current!);
    expect(io.adapter()).toBe(current);
  });
});
