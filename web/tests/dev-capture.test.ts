import test from 'node:test';
import assert from 'node:assert/strict';
import {GET,POST} from '../app/api/dev-capture/route';

test('local capture storage is closed in production and rejects foreign origins and paths',async()=>{
  const environment=process.env as Record<string,string|undefined>;const original=environment.NODE_ENV;
  try{
    environment.NODE_ENV='production';
    assert.equal((await GET(new Request('http://localhost:3000/api/dev-capture?id=test'))).status,404);
    assert.equal((await POST(new Request('http://localhost:3000/api/dev-capture',{method:'POST'}))).status,404);
    environment.NODE_ENV='development';
    assert.equal((await POST(new Request('http://localhost:3000/api/dev-capture',{method:'POST',headers:{origin:'https://example.com'}}))).status,403);
    assert.equal((await GET(new Request('http://example.com/api/dev-capture?id=test'))).status,404);
    assert.equal((await GET(new Request('http://localhost:3000/api/dev-capture?id=../../README.md'))).status,400);
    assert.equal((await POST(new Request('http://localhost:3000/api/dev-capture',{method:'POST',headers:{origin:'http://localhost:3000','Content-Type':'image/png'},body:'not an image'}))).status,400);
  }finally{if(original===undefined)delete environment.NODE_ENV;else environment.NODE_ENV=original;}
});
