import { describe, expect, test } from 'bun:test'
import { summarizeSubAgentReportForContext } from '../subAgentSummary'

describe('summarizeSubAgentReportForContext', () => {
  test('extracts bullets from Findings/Recommendations', () => {
    const input = `## Summary
blah

## Findings
- One
- Two
- Three
- Four

## Recommendations
1) Fix A
2) Fix B

## Conclusion
done`

    const output = summarizeSubAgentReportForContext(input)

    expect(output).toContain('Key findings:')
    expect(output).toContain('- One')
    expect(output).toContain('- Two')
    expect(output).toContain('- Three')
    expect(output).not.toContain('- Four')
    expect(output).toContain('Key recommendations:')
    expect(output).toContain('- Fix A')
    expect(output).toContain('- Fix B')
  })

  test('filters out <tool_call> artifacts', () => {
    const input = `<tool_call>
<function=reading>
<parameter=content>hello

## Findings
- Real finding
`

    const output = summarizeSubAgentReportForContext(input)

    expect(output).not.toContain('<tool_call>')
    expect(output).not.toContain('<function=reading>')
    expect(output).not.toContain('<parameter=content>')
    expect(output).toContain('Real finding')
  })

  test('falls back to first non-empty lines when sections are missing', () => {
    const input = `

Line 1

Line 2
Line 3
`
    const output = summarizeSubAgentReportForContext(input)
    expect(output).toContain('Line 1')
    expect(output).toContain('Line 2')
  })
})
