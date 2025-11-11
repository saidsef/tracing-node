#!/bin/bash
# Script to create all 12 GitHub issues from the documentation

set -e

echo "Creating GitHub issues from .github/ISSUES/ documentation..."
echo ""

# Issue 1: Security - Input Validation
echo "Creating issue 1/12: Security - Input Validation"
gh issue create \
  --title "Security Fix: Missing Input Validation for Critical Parameters" \
  --body-file .github/ISSUES/001-security-input-validation.md \
  --label "security,high-priority" \
  --assignee saidsef

# Issue 2: Security - Resource Exhaustion
echo "Creating issue 2/12: Security - Resource Exhaustion"
gh issue create \
  --title "Security Fix: Potential Resource Exhaustion in Batch Span Processing" \
  --body-file .github/ISSUES/002-security-resource-exhaustion.md \
  --label "security,medium-priority" \
  --assignee saidsef

# Issue 3: Security - Error Handling
echo "Creating issue 3/12: Security - Error Handling"
gh issue create \
  --title "Security Fix: Error Handling Exposes Internal Implementation Details" \
  --body-file .github/ISSUES/003-security-error-handling.md \
  --label "security,medium-priority" \
  --assignee saidsef

# Issue 4: Bug - README Typo
echo "Creating issue 4/12: Bug - README Typo"
gh issue create \
  --title "Bug Fix: Typo in README Fork Link" \
  --body-file .github/ISSUES/004-bug-readme-typo.md \
  --label "bug,low-priority,documentation" \
  --assignee saidsef

# Issue 5: Bug - Test Suite Mismatch
echo "Creating issue 5/12: Bug - Test Suite Mismatch"
gh issue create \
  --title "Bug Fix: Test Suite Doesn't Match Actual Function Signature" \
  --body-file .github/ISSUES/005-bug-test-mismatch.md \
  --label "bug,high-priority,testing" \
  --assignee saidsef

# Issue 6: Bug - Error Propagation
echo "Creating issue 6/12: Bug - Error Propagation"
gh issue create \
  --title "Bug Fix: Missing Error Propagation in stopTracing" \
  --body-file .github/ISSUES/006-bug-missing-error-propagation.md \
  --label "bug,medium-priority" \
  --assignee saidsef

# Issue 7: Bug - parseInt Radix
echo "Creating issue 7/12: Bug - parseInt Radix"
gh issue create \
  --title "Bug Fix: parseInt Used Without Radix Parameter" \
  --body-file .github/ISSUES/007-bug-parseint-without-radix.md \
  --label "bug,medium-priority,code-quality" \
  --assignee saidsef

# Issue 8: Tracing - Error Tracking
echo "Creating issue 8/12: Tracing - Error Tracking"
gh issue create \
  --title "Tracing Improvement: Add Structured Error Tracking for All Instrumentations" \
  --body-file .github/ISSUES/008-tracing-structured-error-tracking.md \
  --label "enhancement,tracing,high-priority" \
  --assignee saidsef

# Issue 9: Tracing - Span Sampling
echo "Creating issue 9/12: Tracing - Span Sampling"
gh issue create \
  --title "Tracing Improvement: Implement Configurable Span Sampling" \
  --body-file .github/ISSUES/009-tracing-span-sampling.md \
  --label "enhancement,tracing,high-priority" \
  --assignee saidsef

# Issue 10: Tracing - Metrics & Exemplars
echo "Creating issue 10/12: Tracing - Metrics & Exemplars"
gh issue create \
  --title "Tracing Improvement: Add Custom Metrics and Exemplars Support" \
  --body-file .github/ISSUES/010-tracing-metrics-exemplars.md \
  --label "enhancement,tracing,medium-priority" \
  --assignee saidsef

# Issue 11: Tracing - Message Queue Propagation
echo "Creating issue 11/12: Tracing - Message Queue Propagation"
gh issue create \
  --title "Tracing Improvement: Enhance Context Propagation for Message Queues" \
  --body-file .github/ISSUES/011-tracing-message-queue-propagation.md \
  --label "enhancement,tracing,medium-priority" \
  --assignee saidsef

# Issue 12: Tracing - Performance Monitoring
echo "Creating issue 12/12: Tracing - Performance Monitoring"
gh issue create \
  --title "Tracing Improvement: Add Performance Monitoring for Slow Operations" \
  --body-file .github/ISSUES/012-tracing-performance-monitoring.md \
  --label "enhancement,tracing,medium-priority" \
  --assignee saidsef

echo ""
echo "✅ All 12 issues created successfully!"
echo ""
echo "View issues at: https://github.com/saidsef/tracing-node/issues"
