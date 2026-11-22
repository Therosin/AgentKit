import { describe, expect, test } from 'bun:test';
import { TextTemplate } from '../src/shared/TextTemplates';

describe('TextTemplate', () => {
    describe('happy paths', () => {
        test('supports callable proxy invocation, render(), instanceof, and Symbol.toPrimitive', async () => {
            const tmpl = new TextTemplate('\nHello, {name}!\n');

            expect(tmpl).toBeInstanceOf(TextTemplate);
            expect(typeof tmpl).toBe('function');
            expect(tmpl.template).toBe('Hello, {name}!');
            expect(`${tmpl}`).toBe('Hello, {name}!');

            expect(await tmpl({ name: 'Alice' })).toBe('Hello, Alice!');
            expect(await tmpl.render({ name: 'Bob' })).toBe('Hello, Bob!');
        });

        test('normalizes only one leading and one trailing newline', () => {
            const tmpl = new TextTemplate('\r\n\r\nline1\r\nline2\r\n\r\n');
            expect(tmpl.template).toBe('\r\nline1\r\nline2\r\n');
        });

        test('resolves nested placeholders recursively regardless of key insertion order', async () => {
            const tmpl = new TextTemplate('{sentence}');
            const output = await tmpl({
                sentence: 'Welcome, {greeting}!',
                greeting: '{salutation} {user}',
                salutation: 'Dr.',
                user: 'Ada',
            });

            expect(output).toBe('Welcome, Dr. Ada!');
        });

        test('composes nested TextTemplates via template interpolation and async values', async () => {
            const header = new TextTemplate('User: {name}');
            const body = new TextTemplate('Role: {role}');
            const combined = new TextTemplate(`${header}\n${body}`);

            expect(await combined({ name: 'Eve', role: 'Admin' })).toBe('User: Eve\nRole: Admin');

            const outer = new TextTemplate('Section:\n{section}');
            const rendered = await outer({
                section: header({ name: 'Mallory' }),
            });
            expect(rendered).toBe('Section:\nUser: Mallory');
        });

        test('evaluates sync and async function context values with filtered args and positional params', async () => {
            const tmpl = new TextTemplate('Greeting: {greet}; Args: $1, $2, missing=$3; All=${...}');
            let receivedFilteredHasSelf = true;

            const output = await tmpl(
                {
                    name: 'Sam',
                    greet: async (filtered: any, first: any, second: any) => {
                        receivedFilteredHasSelf = 'greet' in filtered;
                        return `Hi ${filtered.name} (${first}/${second})`;
                    },
                },
                'alpha',
                'beta',
            );

            expect(receivedFilteredHasSelf).toBe(false);
            expect(output).toBe('Greeting: Hi Sam (alpha/beta); Args: alpha, beta, missing=$3; All=alpha beta');
        });

        test('evaluates IF / !IF / ELSE blocks including nested branches', async () => {
            const tmpl = new TextTemplate(`
{#IF active}
Status: ON
{#IF !muted}
Sound: ON
{#ELSE}
Sound: MUTED
{#END}
{#ELSE}
Status: OFF
{#END}
`);

            expect(await tmpl({ active: true, muted: false })).toBe('Status: ON\nSound: ON\n');
            expect(await tmpl({ active: true, muted: true })).toBe('Status: ON\nSound: MUTED\n');
            expect(await tmpl({ active: false, muted: false })).toBe('Status: OFF\n');
        });

        test('evaluates FOR loops over arrays and skips null/undefined collections', async () => {
            const tmpl = new TextTemplate(`
{#FOR item IN items}
- {item}
{#END}
Done`);

            expect(await tmpl({ items: ['a', 'b'] })).toBe('- a\n- b\nDone');
            expect(await tmpl({ items: [] })).toBe('Done');
            expect(await tmpl({ items: null })).toBe('Done');
            expect(await tmpl({})).toBe('Done');
        });

        test('evaluates WITH blocks including nested WITH inside FOR', async () => {
            const tmpl = new TextTemplate(`
{#FOR user IN users}
{#WITH user}
{username}:
{#WITH profile}
  {bio}
{#END}
{#END}
{#END}`);

            const output = await tmpl({
                users: [
                    { username: 'alice', profile: { bio: 'Builder' } },
                    { username: 'bob', profile: { bio: 'Tester' } },
                ],
            });

            expect(output).toBe('alice:\n  Builder\nbob:\n  Tester\n');
        });

        test('supports SET, INC, and DEC with literals and isolates locals per render', async () => {
            const tmpl = new TextTemplate(`
{#SET count: 0}
{#SET label: "hello"}
{#SET neg: -2.5}
{#SET flag: false}
{#SET empty: null}
{#INC count}
{#INC count}
{#DEC count}
{count}|{label}|{neg}|{flag}|{empty}`);

            expect(await tmpl()).toBe('1|hello|-2.5|false|null');
            // Second render starts fresh; locals do not leak across renders
            expect(await tmpl()).toBe('1|hello|-2.5|false|null');
        });

        test('respects scope precedence: temporary (FOR/WITH) > context > locals', async () => {
            const tmpl = new TextTemplate(`
{#SET name: "local"}
top={name}
{#WITH obj}
inner={name}
{#END}
after={name}`);

            const withContext = await tmpl({ name: 'ctx', obj: { name: 'temp' } });
            expect(withContext).toBe('top=ctx\ninner=temp\nafter=ctx');

            const withoutContext = await tmpl({ obj: { name: 'temp' } });
            expect(withoutContext).toBe('top=local\ninner=temp\nafter=local');
        });

        test('clone(), indent(), and trimLines() produce independent transformed templates', async () => {
            const orig = new TextTemplate('  hello   \n\n  {name}  ');
            const cloned = orig.clone();
            cloned.template = 'changed';

            expect(orig.template).toBe('  hello   \n\n  {name}  ');

            const indented = orig.indent(2);
            expect(indented.template).toBe('    hello   \n\n    {name}  ');

            const trimmed = orig.trimLines();
            expect(trimmed.template).toBe('  hello\n\n  {name}');
            expect(await trimmed({ name: 'world' })).toBe('  hello\n\n  world');
        });
    });

    describe('security, immutability & error paths', () => {
        test('toString() throws guidance error', () => {
            const tmpl = new TextTemplate('hi');
            expect(() => tmpl.toString()).toThrow('Use await template() instead of toString()');
        });

        test('breaks cyclic and self-referential placeholders safely without infinite recursion', async () => {
            const tmpl = new TextTemplate('{a} | {self}');
            const output = await tmpl({
                a: '{b}',
                b: '{a}',
                self: '{self}',
            });

            expect(output).toBe('{a} | {self}');
        });

        test('does not reparse template directives injected via context values', async () => {
            const tmpl = new TextTemplate('Msg: {payload}');
            const output = await tmpl({
                payload: '{#IF evil}\nHACKED\n{#END}',
                evil: true,
            });

            expect(output).toBe('Msg: {#IF evil}\nHACKED\n{#END}');
        });

        test('SET, INC, and DEC are no-ops when targeting caller context or temporary FOR/WITH bindings', async () => {
            const tmpl = new TextTemplate(`
{#SET ctxVal: "mutated"}
{#INC ctxNum}
{#WITH box}
{#SET inner: 99}
{#INC inner}
box={inner}
{#END}
ctx={ctxVal}:{ctxNum}`);

            const output = await tmpl({
                ctxVal: 'original',
                ctxNum: 10,
                box: { inner: 5 },
            });

            expect(output).toBe('box=5\nctx=original:10');
        });

        test('leaves dotted property paths literal as documented', async () => {
            const tmpl = new TextTemplate('Hello {user.name}');
            expect(await tmpl({ user: { name: 'Ada' } })).toBe('Hello {user.name}');
        });

        test('throws syntax errors for malformed blocks and directives', async () => {
            await expect(new TextTemplate('{#IF x}\nhi')()).rejects.toThrow('Unclosed {#IF} block');
            await expect(new TextTemplate('{#FOR x IN xs}\nhi')()).rejects.toThrow('Unclosed {#FOR} block');
            await expect(new TextTemplate('{#WITH obj}\nhi')()).rejects.toThrow('Unclosed {#WITH} block');
            await expect(new TextTemplate('{#END}')()).rejects.toThrow('#END without an open block on line 1');
            await expect(new TextTemplate('{#ELSE}')()).rejects.toThrow('{#ELSE} is only valid in an IF block on line 1');
            await expect(new TextTemplate('{#FOR x IN xs}\n{#ELSE}\n{#END}')()).rejects.toThrow('{#ELSE} is only valid in an IF block on line 2');
            await expect(new TextTemplate('{#IF x}\na\n{#ELSE}\nb\n{#ELSE}\nc\n{#END}')()).rejects.toThrow('Duplicate {#ELSE} on line 5');
            await expect(new TextTemplate('{#IF a == b}\n{#END}')()).rejects.toThrow('Invalid directive on line 1');
            await expect(new TextTemplate('{#WHILE x}\n{#END}')()).rejects.toThrow('Unknown directive on line 1');
            await expect(new TextTemplate('{#SET x: unquoted}')()).rejects.toThrow('Invalid SET value on line 1');
            await expect(new TextTemplate('{#SET x: "unterminated\\"}')()).rejects.toThrow('Invalid string literal on line 1');
        });

        test('throws runtime errors for invalid INC/DEC, FOR, and WITH targets', async () => {
            await expect(new TextTemplate('{#INC missing}')()).rejects.toThrow('requires a numeric template local');
            await expect(new TextTemplate('{#SET s: "abc"}\n{#DEC s}')()).rejects.toThrow('requires a numeric template local');

            await expect(new TextTemplate('{#FOR x IN val}\n{x}\n{#END}')({ val: 123 })).rejects.toThrow('requires an array');
            await expect(new TextTemplate('{#FOR x IN val}\n{x}\n{#END}')({ val: { a: 1 } })).rejects.toThrow('requires an array');

            await expect(new TextTemplate('{#WITH obj}\nhi\n{#END}')({ obj: null })).rejects.toThrow('requires a non-null object');
            await expect(new TextTemplate('{#WITH obj}\nhi\n{#END}')({ obj: undefined })).rejects.toThrow('requires a non-null object');
            await expect(new TextTemplate('{#WITH obj}\nhi\n{#END}')({ obj: 'str' })).rejects.toThrow('requires a non-null object');
            await expect(new TextTemplate('{#WITH obj}\nhi\n{#END}')({ obj: [1, 2] })).rejects.toThrow('requires a non-null object');
        });
    });
});
