/** Builds ConnectWise REST API condition strings. */
export class ConditionBuilder {
  private conditions: string[] = [];

  addCondition(field: string, operator: string, value: unknown): this {
    let formatted: string;
    if (value === null) {
      formatted = 'null';
    } else if (typeof value === 'boolean') {
      formatted = value.toString();
    } else if (typeof value === 'number') {
      formatted = value.toString();
    } else if (typeof value === 'string') {
      formatted = `"${value.replace(/"/g, '\\"')}"`;
    } else if (value instanceof Date) {
      formatted = `[${value.toISOString()}]`;
    } else {
      throw new Error(`Unsupported condition value type: ${typeof value}`);
    }
    this.conditions.push(`${field} ${operator} ${formatted}`);
    return this;
  }

  addLikeCondition(field: string, value: string): this {
    this.conditions.push(`${field} like "${value.replace(/"/g, '\\"')}%"`);
    return this;
  }

  addContainsCondition(field: string, value: string): this {
    this.conditions.push(`${field} contains "${value.replace(/"/g, '\\"')}"`);
    return this;
  }

  addInCondition(field: string, values: string[]): this {
    const list = values.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(',');
    this.conditions.push(`${field} in (${list})`);
    return this;
  }

  addNotInCondition(field: string, values: string[]): this {
    const list = values.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(',');
    this.conditions.push(`${field} not in (${list})`);
    return this;
  }

  /** A pre-built clause, parenthesized so it composes with AND (used for OR groups). */
  addGroup(clause: string): this {
    if (clause.trim()) this.conditions.push(`(${clause})`);
    return this;
  }

  build(): string {
    return this.conditions.join(' AND ');
  }
}
