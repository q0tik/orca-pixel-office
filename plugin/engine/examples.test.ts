import { readdirSync, readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { isWorkerDesk, WORKER_ROOM } from './workers'
import { parseMap } from './world'
import { realMap } from './fixtures'

// Every example office in examples/offices loads without errors, with desks, a sofa or kitchen and an owner.
const dir = new URL('../../examples/offices/', import.meta.url).pathname

test('example offices load without errors', () => {
  const names = readdirSync(dir).filter((n) => !n.startsWith('.') && !n.includes('.'))
  assert.ok(names.length >= 3, `examples: ${names.join(', ')}`)
  const problems = names.flatMap((name) => {
    const { world, errors } = parseMap(JSON.parse(readFileSync(`${dir}${name}/map.json`, 'utf8')))
    if (!world?.desks.some((d) => d.roomKind === 'clevel')) errors.push('no office desks')
    return errors.map((e) => `${name}: ${e}`)
  })
  assert.deepEqual(problems, [])
})

test('workers sit in every room of kind team; on the shipped map that is «Команды и отделы» alone', () => {
  assert.deepEqual([...new Set(realMap().desks.filter(isWorkerDesk).map((d) => d.room))], [WORKER_ROOM])
  const { world } = parseMap(JSON.parse(readFileSync(`${dir}corp/map.json`, 'utf8')))
  assert.deepEqual([...new Set(world!.desks.filter(isWorkerDesk).map((d) => d.room))], ['open-a', 'open-b'])
  assert.equal(world!.desks.filter(isWorkerDesk).length, 48)
})
