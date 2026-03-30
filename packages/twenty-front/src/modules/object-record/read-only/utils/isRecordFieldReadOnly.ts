import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { isFieldMetadataReadOnlyByPermissions } from '@/object-record/read-only/utils/internal/isFieldMetadataReadOnlyByPermissions';
import { type ObjectPermission } from '~/generated-metadata/graphql';

/**
 * Type-safe narrowing function — avoids `as any` casts.
 * Returns true if the settings object has a non-empty computedFormula.
 */
function hasComputedFormula(
  settings: unknown,
): settings is { computedFormula: string } {
  return (
    typeof settings === 'object' &&
    settings !== null &&
    'computedFormula' in settings &&
    typeof (settings as { computedFormula: unknown }).computedFormula ===
      'string' &&
    (settings as { computedFormula: string }).computedFormula.trim().length > 0
  );
}

type IsRecordFieldReadOnlyParams = {
  isRecordReadOnly: boolean;
  isSystemObject?: boolean;
  fieldMetadataItem: Pick<
    FieldMetadataItem,
    'id' | 'isUIReadOnly' | 'isCustom' | 'settings'
  >;
  objectPermissions: ObjectPermission;
};

export const isRecordFieldReadOnly = ({
  objectPermissions,
  isRecordReadOnly,
  isSystemObject,
  fieldMetadataItem,
}: IsRecordFieldReadOnlyParams) => {
  const fieldReadOnlyByPermissions = isFieldMetadataReadOnlyByPermissions({
    objectPermissions,
    fieldMetadataId: fieldMetadataItem.id,
  });

  return (
    isRecordReadOnly ||
    (isSystemObject === true && fieldMetadataItem.isCustom !== true) ||
    fieldMetadataItem.isUIReadOnly ||
    fieldReadOnlyByPermissions ||
    hasComputedFormula(fieldMetadataItem.settings)
  );
};
