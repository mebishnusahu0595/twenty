import { Injectable } from '@nestjs/common';

import { msg } from '@lingui/core/macro';
import { type ObjectRecord } from 'twenty-shared/types';

import { WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { CommonBaseQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-base-query-runner.service';
import { CommonUpdateManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-update-many-query-runner.service';
import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { CommonBaseQueryRunnerContext } from 'src/engine/api/common/types/common-base-query-runner-context.type';
import { CommonExtendedQueryRunnerContext } from 'src/engine/api/common/types/common-extended-query-runner-context.type';
import {
  CommonExtendedInput,
  CommonInput,
  CommonQueryNames,
  UpdateOneQueryArgs,
} from 'src/engine/api/common/types/common-query-args.type';
import { assertIsValidUuid } from 'src/engine/api/graphql/workspace-query-runner/utils/assert-is-valid-uuid.util';
import { FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { assertMutationNotOnRemoteObject } from 'src/engine/metadata-modules/object-metadata/utils/assert-mutation-not-on-remote-object.util';

@Injectable()
export class CommonUpdateOneQueryRunnerService extends CommonBaseQueryRunnerService<
  UpdateOneQueryArgs,
  ObjectRecord
> {
  constructor(
    private readonly commonUpdateManyQueryRunnerService: CommonUpdateManyQueryRunnerService,
  ) {
    super();
  }
  protected readonly operationName = CommonQueryNames.UPDATE_ONE;

  /**
   * run() executes INSIDE executeInWorkspaceContext(), so the AsyncLocalStorage
   * workspace context is properly set here. This is the correct place to:
   *   1. Fetch the existing record (for computed field context)
   *   2. Process the incoming data args (validation + computed fields)
   *   3. Delegate the actual DB update to commonUpdateManyQueryRunnerService
   */
  async run(
    args: CommonExtendedInput<UpdateOneQueryArgs>,
    queryRunnerContext: CommonExtendedQueryRunnerContext,
  ): Promise<ObjectRecord> {
    const {
      repository,
      authContext,
      flatObjectMetadata,
      flatFieldMetadataMaps,
      flatObjectMetadataMaps,
    } = queryRunnerContext;

    // Fetch the existing record here — inside the workspace context where
    // the ORM's AsyncLocalStorage is correctly initialized.
    const existingRecord = await repository.findOne({
      where: { id: args.id } as any,
    });

    // Process data args with the existing record available for computed fields.
    const processedData = (
      await this.dataArgProcessor.process({
        partialRecordInputs: [args.data],
        authContext,
        flatObjectMetadata,
        flatFieldMetadataMaps,
        flatObjectMetadataMaps,
        shouldBackfillPositionIfUndefined: false,
        existingRecords: existingRecord ? [existingRecord] : undefined,
      })
    )[0];

    const result = await this.commonUpdateManyQueryRunnerService.run(
      {
        ...args,
        data: processedData,
        filter: { id: { eq: args.id } },
      },
      queryRunnerContext,
    );

    if (!result || result.length === 0) {
      throw new CommonQueryRunnerException(
        'Record not found',
        CommonQueryRunnerExceptionCode.RECORD_NOT_FOUND,
        {
          userFriendlyMessage: msg`This record does not exist or has been deleted.`,
        },
      );
    }

    return result[0];
  }

  /**
   * computeArgs() runs BEFORE executeInWorkspaceContext() sets the workspace
   * context. Therefore, we MUST NOT do any DB access or call dataArgProcessor
   * here. Only pure, synchronous validation is appropriate.
   */
  async computeArgs(
    args: CommonInput<UpdateOneQueryArgs>,
    _queryRunnerContext: CommonBaseQueryRunnerContext,
  ): Promise<CommonInput<UpdateOneQueryArgs>> {
    // No DB access here. DB access and data processing moved to run().
    return args;
  }

  async processQueryResult(
    queryResult: ObjectRecord,
    flatObjectMetadata: FlatObjectMetadata,
    flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata>,
    flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>,
    authContext: WorkspaceAuthContext,
  ): Promise<ObjectRecord> {
    return this.commonResultGettersService.processRecord(
      queryResult,
      flatObjectMetadata,
      flatObjectMetadataMaps,
      flatFieldMetadataMaps,
      authContext.workspace.id,
    );
  }

  async validate(
    args: CommonInput<UpdateOneQueryArgs>,
    queryRunnerContext: CommonBaseQueryRunnerContext,
  ): Promise<void> {
    const { flatObjectMetadata } = queryRunnerContext;

    assertMutationNotOnRemoteObject(flatObjectMetadata);
    assertIsValidUuid(args.id);
  }
}
