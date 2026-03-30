import { Injectable } from '@nestjs/common';
import { Parser } from 'expr-eval';
import { isDefined } from 'twenty-shared/utils';

import { FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';

/**
 * ComputedFieldService
 *
 * A field-type-agnostic service for evaluating computed field formulas.
 * Supports any field type whose settings carry a `computedFormula` property.
 * Designed to be extended with custom functions (e.g. addDays, concat).
 */
@Injectable()
export class ComputedFieldService {
  private readonly parser: Parser;

  constructor() {
    // Extend the parser with safe built-in functions for future field types.
    this.parser = new Parser({
      operators: {
        // Disable assignment to prevent side-effects in formulas
        assignment: false,
      },
    });

    // Register custom functions that can be used in formulas.
    // Example: addDays(date, 7), concat(firstName, " ", lastName)
    this.parser.functions['concat'] = (...args: unknown[]) =>
      args.map(String).join('');
    this.parser.functions['addDays'] = (date: string, days: number) => {
      const d = new Date(date);
      d.setDate(d.getDate() + days);
      return d.toISOString();
    };
    this.parser.functions['upper'] = (s: string) => String(s).toUpperCase();
    this.parser.functions['lower'] = (s: string) => String(s).toLowerCase();
  }

  /**
   * Returns all fields that have a non-empty computedFormula setting,
   * regardless of their field type. This makes the system abstract.
   */
  public getComputedFields(fields: FlatFieldMetadata[]): FlatFieldMetadata[] {
    return fields.filter((field) => {
      const formula = (field.settings as any)?.computedFormula;
      return isDefined(formula) && typeof formula === 'string' && formula.trim().length > 0;
    });
  }

  /**
   * Extracts the variable names (dependencies) from a formula string.
   * e.g. "price * quantity" → ["price", "quantity"]
   */
  public extractDependencies(formula: string): string[] {
    try {
      return this.parser.parse(formula).variables();
    } catch {
      return [];
    }
  }

  /**
   * Evaluates a formula against a context object.
   * Throws a structured CommonQueryRunnerException on failure.
   * NEVER swallows errors — callers get a clear, user-friendly message.
   */
  public evaluate(
    formula: string,
    context: Record<string, unknown>,
    fieldName: string,
  ): unknown {
    try {
      const expr = this.parser.parse(formula);
      return expr.evaluate(context as Record<string, any>);
    } catch (error) {
      throw new CommonQueryRunnerException(
        `Failed to evaluate computed formula for field "${fieldName}": ${(error as Error).message}. Formula: "${formula}"`,
        CommonQueryRunnerExceptionCode.INVALID_ARGS_DATA,
        {
          userFriendlyMessage: `The formula for field "${fieldName}" is invalid or references a missing field.`,
        },
      );
    }
  }

  /**
   * Performs topological sort of computed fields based on their dependencies.
   * Throws a structured exception if a circular dependency is detected.
   */
  public sortByDependency(
    computedFields: FlatFieldMetadata[],
  ): FlatFieldMetadata[] {
    const computedFieldNames = new Set(computedFields.map((f) => f.name));
    const graph = new Map<string, string[]>();

    for (const field of computedFields) {
      const formula = (field.settings as any)?.computedFormula ?? '';
      const deps = this.extractDependencies(formula).filter((dep) =>
        computedFieldNames.has(dep),
      );
      graph.set(field.name, deps);
    }

    const sortedNames: string[] = [];
    const visited = new Set<string>();
    const processing = new Set<string>();

    const visit = (name: string): void => {
      if (processing.has(name)) {
        throw new CommonQueryRunnerException(
          `Circular dependency detected in computed fields involving field "${name}".`,
          CommonQueryRunnerExceptionCode.INVALID_ARGS_DATA,
          {
            userFriendlyMessage: `A circular dependency was detected in the computed field formulas. Please check the formula for field "${name}".`,
          },
        );
      }
      if (visited.has(name)) return;

      processing.add(name);
      for (const dep of graph.get(name) ?? []) {
        visit(dep);
      }
      processing.delete(name);
      visited.add(name);
      sortedNames.push(name);
    };

    for (const field of computedFields) {
      visit(field.name);
    }

    return sortedNames.map(
      (name) => computedFields.find((f) => f.name === name)!,
    );
  }
}
