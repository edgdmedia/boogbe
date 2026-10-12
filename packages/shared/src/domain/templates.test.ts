import { describe, expect, it } from 'vitest';
import { UpdateTemplateInput } from '../contracts/messages';
import { DEFAULT_TEMPLATES, PLACEHOLDERS, markdownToHtml, render, renderHtml, SAMPLE_VARS, TEMPLATE_KEYS, TEMPLATE_LABELS, unknownPlaceholders, waLink } from './templates';

describe('templates [MSG-02]', () => {
  it('renders known placeholders with optional spaces', () => {
    expect(render('Hi {{guest.firstName}}, ref {{ booking.ref }}.', { ...SAMPLE_VARS, 'guest.firstName': 'Ada', 'booking.ref': 'TAN-2610-0001' })).toBe('Hi Ada, ref TAN-2610-0001.');
  });
  it('renders an unknown placeholder as empty text', () => {
    expect(render('Hi {{ guest.nickname }}!', SAMPLE_VARS)).toBe('Hi !');
  });
  it('does not re-expand placeholders inside values', () => {
    expect(render('{{guest.firstName}}', { ...SAMPLE_VARS, 'guest.firstName': '{{booking.ref}}' })).toBe('{{booking.ref}}');
  });
  it('reports unknown placeholders once each', () => {
    expect(unknownPlaceholders('Hi {{guest.firstName}} {{guest.lastname}} {{ foo }} {{foo}}')).toEqual(['guest.lastname', 'foo']);
  });
  it('every default template uses only known placeholders', () => {
    for (const k of TEMPLATE_KEYS) {
      const t = DEFAULT_TEMPLATES[k];
      expect(unknownPlaceholders(t.emailSubject + t.emailBody + t.whatsappBody), k).toEqual([]);
    }
  });
  it('has a default, a label and a sample for every key and placeholder [MSG-01]', () => {
    expect(Object.keys(DEFAULT_TEMPLATES).sort()).toEqual([...TEMPLATE_KEYS].sort());
    expect(Object.keys(TEMPLATE_LABELS).sort()).toEqual([...TEMPLATE_KEYS].sort());
    expect(Object.keys(SAMPLE_VARS).sort()).toEqual([...PLACEHOLDERS].sort());
  });
  it('check-in details carry the unit instructions [MSG-07]', () => {
    expect(DEFAULT_TEMPLATES.check_in_details.emailBody).toContain('{{unit.checkInInstructions}}');
  });
  it('only the pre-arrival reminder is off by default', () => {
    expect(TEMPLATE_KEYS.filter((k) => !DEFAULT_TEMPLATES[k].autoEmail)).toEqual(['pre_arrival_reminder']);
  });
  it('defaults fit the edit limits', () => {
    for (const k of TEMPLATE_KEYS) expect(UpdateTemplateInput.safeParse({ ...DEFAULT_TEMPLATES[k], active: true }).success, k).toBe(true);
  });
});

describe('markdownToHtml', () => {
  it('supports paragraphs, line breaks, bold and https links', () => {
    expect(markdownToHtml('Hello **Ada**\nSee [map](https://maps.google.com/x)\n\nBye')).toBe(
      '<p>Hello <strong>Ada</strong><br>See <a href="https://maps.google.com/x">map</a></p><p>Bye</p>');
  });
  it('escapes html', () => {
    expect(markdownToHtml('<script>alert(1)</script> & "x"')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;</p>');
  });
  it('refuses non-https links', () => {
    expect(markdownToHtml('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>');
    expect(markdownToHtml('[x](http://a.com)')).toBe('<p>[x](http://a.com)</p>');
  });
  it('cannot break out of the href attribute', () => {
    expect(markdownToHtml('[x](https://a.com/"onmouseover="alert`1`)')).not.toMatch(/href="[^"]*"onmouseover/);
  });
  it('does not put bold tags inside a link address', () => {
    expect(markdownToHtml('[x](https://a.com/**y**)')).toBe('<p><a href="https://a.com/**y**">x</a></p>');
  });
  it('ignores internal token characters typed into the text', () => {
    expect(markdownToHtml('a0b [x](https://a.com)')).toBe('<p>a0b <a href="https://a.com">x</a></p>');
    expect(renderHtml('0{{guest.firstName}}', { ...SAMPLE_VARS, 'guest.firstName': 'Ada' })).toBe('<p>0Ada</p>');
  });
  it('treats Windows line endings like Unix ones', () => {
    expect(markdownToHtml('a\r\nb\r\n\r\nc')).toBe('<p>a<br>b</p><p>c</p>');
  });
});

describe('renderHtml', () => {
  it('formats the template and escapes the values', () => {
    expect(renderHtml('Hi **{{guest.firstName}}**', { ...SAMPLE_VARS, 'guest.firstName': '<b>Ada</b>' })).toBe('<p>Hi <strong>&lt;b&gt;Ada&lt;/b&gt;</strong></p>');
  });
  it('never treats placeholder values as Markdown', () => {
    const html = renderHtml('Hi {{guest.firstName}}', { ...SAMPLE_VARS, 'guest.firstName': '**Ada** [pay here](https://evil.example)' });
    expect(html).toBe('<p>Hi **Ada** [pay here](https://evil.example)</p>');
  });
  it('keeps line breaks in multi-line values', () => {
    expect(renderHtml('{{unit.checkInInstructions}}', { ...SAMPLE_VARS, 'unit.checkInInstructions': 'Gate 4821\nKey in lockbox' })).toBe('<p>Gate 4821<br>Key in lockbox</p>');
  });
});

describe('waLink [MSG-04]', () => {
  it('builds a wa.me link with encoded text', () => {
    expect(waLink('+2348107548559', 'Hi Ada & co\nSee you')).toBe('https://wa.me/2348107548559?text=Hi%20Ada%20%26%20co%0ASee%20you');
  });
  it('encodes the naira sign', () => {
    expect(waLink('+2348107548559', '₦5')).toBe('https://wa.me/2348107548559?text=%E2%82%A65');
  });
});

describe('UpdateTemplateInput', () => {
  const ok = { emailSubject: 'Hi', emailBody: 'Body', whatsappBody: 'WA', autoEmail: true, active: true };
  it('refuses unknown placeholders with the field and name', () => {
    const r = UpdateTemplateInput.safeParse({ ...ok, emailBody: 'Hi {{guest.nickname}}' });
    expect(r.success).toBe(false);
    expect(r.error!.issues).toEqual([expect.objectContaining({ path: ['emailBody'], message: 'Unknown placeholder: {{guest.nickname}}' })]);
  });
  it('refuses an empty subject', () => {
    expect(UpdateTemplateInput.safeParse({ ...ok, emailSubject: '  ' }).success).toBe(false);
  });
});
