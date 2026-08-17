import { test } from '../../fixtures/test';
import { describeSessionValidationCases } from '../_shared/session-validation-cases';

// Identical in coverage to suite 09 (blocks) — see the shared module.
test.describe.serial('Hosted Session - Session Loading & Validation (Classic)', () => {
  describeSessionValidationCases('classic');
});
