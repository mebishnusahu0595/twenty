import { Test, TestingModule } from '@nestjs/testing';
import { FieldMetadataType } from 'twenty-shared/types';

import { ComputedFieldService } from './computed-field.service';

/**
 * Helper: build a minimal FlatFieldMetadata fixture with a computedFormula.
 */
const makeField = (
  name: string,
  formula?: string,
  type: FieldMetadataType = FieldMetadataType.NUMBER,
) =>
  ({
    id: `${name}-id`,
    name,
    type,
    objectMetadataId: 'obj-id',
    universalIdentifier: `${name}-uid`,
    isNullable: true,
    settings: formula ? { computedFormula: formula } : {},
  }) as any;

describe('ComputedFieldService', () => {
  let service: ComputedFieldService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ComputedFieldService],
    }).compile();

    service = module.get<ComputedFieldService>(ComputedFieldService);
  });

  // ── getComputedFields ────────────────────────────────────────────────────

  describe('getComputedFields()', () => {
    it('returns only fields with a non-empty computedFormula', () => {
      const fields = [
        makeField('price'),                        // no formula → excluded
        makeField('total', 'price * quantity'),    // formula → included
        makeField('margin', ''),                   // empty → excluded
        makeField('fullName', 'concat(first, " ", last)', FieldMetadataType.TEXT),
      ];

      const result = service.getComputedFields(fields);

      expect(result).toHaveLength(2);
      expect(result.map((f) => f.name)).toEqual(['total', 'fullName']);
    });

    it('returns an empty array when no fields have formulas', () => {
      const fields = [makeField('price'), makeField('quantity')];
      expect(service.getComputedFields(fields)).toHaveLength(0);
    });
  });

  // ── evaluate ─────────────────────────────────────────────────────────────

  describe('evaluate()', () => {
    it('evaluates a numeric formula', () => {
      const result = service.evaluate('price * quantity', { price: 10, quantity: 5 }, 'total');
      expect(result).toBe(50);
    });

    it('evaluates a formula with percentage discount', () => {
      const result = service.evaluate(
        'price * (1 - discount / 100)',
        { price: 100, discount: 20 },
        'finalPrice',
      );
      expect(result).toBe(80);
    });

    it('evaluates the built-in concat() function', () => {
      const result = service.evaluate(
        'concat(first, " ", last)',
        { first: 'John', last: 'Doe' },
        'fullName',
      );
      expect(result).toBe('John Doe');
    });

    it('evaluates the built-in upper() function', () => {
      const result = service.evaluate('upper(name)', { name: 'twenty' }, 'displayName');
      expect(result).toBe('TWENTY');
    });

    it('throws a structured CommonQueryRunnerException on invalid formula', () => {
      expect(() =>
        service.evaluate('price *', { price: 10 }, 'total'),
      ).toThrow();
    });

    it('throws a structured CommonQueryRunnerException when a variable is missing', () => {
      expect(() =>
        service.evaluate('price * quantity', { price: 10 }, 'total'),
      ).toThrow(/total/);
    });
  });

  // ── extractDependencies ──────────────────────────────────────────────────

  describe('extractDependencies()', () => {
    it('extracts variable names from a formula', () => {
      const deps = service.extractDependencies('price * (1 - discount / 100)');
      expect(deps).toEqual(expect.arrayContaining(['price', 'discount']));
    });

    it('returns empty array for an invalid formula', () => {
      const deps = service.extractDependencies('price *');
      expect(deps).toEqual([]);
    });
  });

  // ── sortByDependency ─────────────────────────────────────────────────────

  describe('sortByDependency()', () => {
    it('returns a single field unchanged', () => {
      const fields = [makeField('total', 'price * quantity')];
      const sorted = service.sortByDependency(fields);
      expect(sorted[0].name).toBe('total');
    });

    it('sorts fields in dependency order (dependency before dependant)', () => {
      const fields = [
        makeField('grandTotal', 'subtotal + tax'),  // depends on subtotal
        makeField('subtotal', 'price * quantity'),   // no computed deps
      ];

      const sorted = service.sortByDependency(fields);
      const names = sorted.map((f) => f.name);

      expect(names.indexOf('subtotal')).toBeLessThan(names.indexOf('grandTotal'));
    });

    it('handles a 3-level dependency chain correctly', () => {
      const fields = [
        makeField('c', 'b + 1'),  // depends on b
        makeField('a', 'x + 1'), // no computed deps
        makeField('b', 'a + 1'), // depends on a
      ];

      const sorted = service.sortByDependency(fields);
      const names = sorted.map((f) => f.name);

      expect(names.indexOf('a')).toBeLessThan(names.indexOf('b'));
      expect(names.indexOf('b')).toBeLessThan(names.indexOf('c'));
    });

    it('throws a structured exception on circular dependency', () => {
      const fields = [
        makeField('a', 'b + 1'),
        makeField('b', 'a + 1'),
      ];

      expect(() => service.sortByDependency(fields)).toThrow(/[Cc]ircular/);
    });

    it('does not throw when fields reference non-computed fields (external deps are fine)', () => {
      // "price" is not in the computedFields array, so it's an external dep
      const fields = [makeField('total', 'price * quantity')];
      expect(() => service.sortByDependency(fields)).not.toThrow();
    });
  });
});
