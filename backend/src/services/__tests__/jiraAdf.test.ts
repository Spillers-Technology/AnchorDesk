/**
 * Unit tests for the Jira ADF <-> plain-text helpers used by JiraProvider.
 * DB-free and network-free.
 */
import { toADF, fromADF } from '../jiraService';

describe('jiraService ADF helpers', () => {
  it('wraps plain text as an ADF doc', () => {
    const adf = toADF('hello world') as { type: string; version: number; content: unknown[] };
    expect(adf.type).toBe('doc');
    expect(adf.version).toBe(1);
    expect(Array.isArray(adf.content)).toBe(true);
  });

  it('splits blank-line-separated paragraphs', () => {
    const adf = toADF('para one\n\npara two') as { content: unknown[] };
    expect(adf.content).toHaveLength(2);
  });

  it('round-trips text through toADF -> fromADF', () => {
    expect(fromADF(toADF('a simple comment'))).toBe('a simple comment');
  });

  it('flattens nested ADF content to text', () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Line ' }, { type: 'text', text: 'one' }] },
      ],
    };
    expect(fromADF(adf)).toBe('Line one');
  });

  it('passes through a legacy string body and tolerates null', () => {
    expect(fromADF('legacy wiki text')).toBe('legacy wiki text');
    expect(fromADF(null)).toBe('');
  });
});
