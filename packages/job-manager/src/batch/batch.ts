// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { BatchServiceModels } from '@azure/batch';
import { Message } from 'azure-services';
import { ServiceConfiguration } from 'common';
import * as crypto from 'crypto';
import { inject, injectable } from 'inversify';
import * as _ from 'lodash';
import { Logger } from 'logger';
import * as moment from 'moment';
import { VError } from 'verror';
import { BatchServiceClientProvider, jobManagerIocTypeNames } from '../job-manager-ioc-types';
import { BatchConfig } from './batch-config';
import { JobTask, JobTaskState } from './job-task';
import { RunnerTaskConfig } from './runner-task-config';

@injectable()
export class Batch {
    private readonly jobTasks: Map<string, JobTask> = new Map();

    public constructor(
        // @inject(ServiceConfiguration) private readonly serviceConfig: ServiceConfiguration,
        @inject(BatchConfig) private readonly config: BatchConfig,
        @inject(RunnerTaskConfig) private readonly runnerTaskConfig: RunnerTaskConfig,
        @inject(jobManagerIocTypeNames.BatchServiceClientProvider) private readonly batchClientProvider: BatchServiceClientProvider,
        @inject(Logger) private readonly logger: Logger,
    ) {}

    public async createJobIfNotExists(jobId: string, addJobIdIndexOnCreate: boolean = false): Promise<string> {
        let serviceJobId = jobId;
        const client = await this.batchClientProvider();

        await client.job
            .get(serviceJobId)
            .then(cloudJob => {
                if (cloudJob.state !== 'active') {
                    throw new VError(`The job ${serviceJobId} is not active and cannot be use to run new tasks.`);
                }
            })
            .catch(async (error: BatchServiceModels.BatchError) => {
                if (error.code === 'JobNotFound') {
                    if (addJobIdIndexOnCreate) {
                        serviceJobId = `${jobId}_${crypto.randomBytes(5).toString('hex')}`;
                    }

                    const jobAddParameter: BatchServiceModels.JobAddParameter = {
                        id: serviceJobId,
                        poolInfo: {
                            poolId: this.config.poolId,
                        },
                        onAllTasksComplete: 'terminatejob',
                    };

                    await client.job.add(jobAddParameter);
                    this.logger.logInfo(`New job ${serviceJobId} created.`);
                } else {
                    throw new VError(error as Error, `An error occurred while retrieving state of ${jobId} job.`);
                }
            });

        return serviceJobId;
    }

    public async createTasks(jobId: string): Promise<JobTask[]> {
        const taskAddParameters: BatchServiceModels.TaskAddParameter[] = [];
        const maxTaskDurationInMinutes = await this.getMaxTaskDurationInMinutes();
        const taskCount = 20 * 8;
        for (let taskPos = 0; taskPos < taskCount; taskPos += 1) {
            const jobTask = new JobTask(`${Date.now()}-taskPos`);
            this.jobTasks.set(jobTask.id, jobTask);
            const taskAddParameter = this.getTaskAddParameter(jobTask.id, maxTaskDurationInMinutes);
            taskAddParameters.push(taskAddParameter);
        }

        await this.addTasks(jobId, taskAddParameters);

        return Array.from(this.jobTasks.values());
    }

    public async waitJob(jobId: string, pullIntervalMilliseconds: number = 10000): Promise<void> {
        this.logger.logInfo(`Waiting for job ${jobId} to complete.`);
        const client = await this.batchClientProvider();

        return new Promise(async (resolve, reject) => {
            const taskListOptions = {
                filter: `state ne '${JobTaskState.completed}'`,
            };
            const timerId = setInterval(async () => {
                await client.task
                    .list(jobId, { taskListOptions: taskListOptions })
                    .then(async (result: BatchServiceModels.CloudTaskListResult) => {
                        if (result.length === 0 || (result.length === 1 && result[0].id === process.env.AZ_BATCH_TASK_ID)) {
                            clearInterval(timerId);
                            this.logger.logInfo(`Job ${jobId} completed.`);
                            resolve();
                        } else {
                            this.logger.logInfo(`Job ${jobId} in progress with ${result.length} pending tasks.`);
                        }
                    })
                    .catch((error: Error) => {
                        clearInterval(timerId);
                        reject(new VError(error, `An error occurred while retrieving the task list for the job ${jobId}`));
                    });
                // tslint:disable-next-line: align
            }, pullIntervalMilliseconds);
        });
    }

    public async getCreatedTasksState(jobId: string): Promise<JobTask[]> {
        const client = await this.batchClientProvider();
        const cloudTaskListResult = await client.task.list(jobId);
        this.setTasksState(cloudTaskListResult);
        let nextLink = cloudTaskListResult.odatanextLink;
        while (!_.isNil(nextLink)) {
            nextLink = await this.getTasksStateNext(nextLink);
        }

        return Array.from(this.jobTasks.values());
    }

    private async addTasks(jobId: string, allTasks: BatchServiceModels.TaskAddParameter[]): Promise<void> {
        const chunkSize = 50;

        if (allTasks.length > 0) {
            const chunks = this.getChunks(allTasks, chunkSize);
            const client = await this.batchClientProvider();

            const taskAddPromises = chunks.map(async taskAddParameters => {
                if (taskAddParameters.length > 0) {
                    const taskAddCollectionResult = await client.task.addCollection(jobId, taskAddParameters);

                    taskAddCollectionResult.value.forEach(taskAddResult => {
                        if (/success/i.test(taskAddResult.status)) {
                            this.jobTasks.get(taskAddResult.taskId).state = JobTaskState.queued;
                            this.logger.logInfo(`New task ${taskAddResult.taskId} added to the job ${jobId}.`);
                        } else {
                            this.jobTasks.get(taskAddResult.taskId).state = JobTaskState.failed;
                            this.jobTasks.get(taskAddResult.taskId).error = taskAddResult.error.message.value;
                            this.logger.logError(
                                `An error occurred while adding new task ${JSON.stringify(taskAddResult)} to the job ${jobId}.`,
                            );
                        }
                    });
                }
            });
            await Promise.all(taskAddPromises);
        } else {
            this.logger.logInfo(`No new tasks added to the job ${jobId}.`);
        }
    }

    private getChunks<T>(allItems: T[], chunkSize: number): T[][] {
        const chunks: T[][] = [];
        const length = allItems.length;

        for (let chunkPos = 0; chunkPos < length; chunkPos += chunkSize) {
            chunks.push(allItems.slice(chunkPos, chunkPos + chunkSize));
        }

        return chunks;
    }

    private async getTasksStateNext(nextPageLink: string): Promise<string> {
        if (!_.isNil(nextPageLink)) {
            const client = await this.batchClientProvider();
            const cloudTaskListResult = await client.task.listNext(nextPageLink);
            this.setTasksState(cloudTaskListResult);

            return cloudTaskListResult.odatanextLink;
        }

        return undefined;
    }

    private setTasksState(cloudTaskList: BatchServiceModels.CloudTaskListResult): void {
        cloudTaskList.forEach(task => {
            if (this.jobTasks.has(task.id)) {
                this.jobTasks.get(task.id).state = task.state;
                this.jobTasks.get(task.id).result = task.executionInfo.result;
                this.logger.logInfo(`Task ${task.id} completed with ${task.executionInfo.result}`);
            }
        });
    }

    private getTaskAddParameter(jobTaskId: string, maxTaskDurationInMinutes: number): BatchServiceModels.TaskAddParameter {
        const commandLine = this.runnerTaskConfig.getCommandLine();

        return {
            id: jobTaskId,
            commandLine: commandLine,
            resourceFiles: this.runnerTaskConfig.getResourceFiles(),
            environmentSettings: this.runnerTaskConfig.getEnvironmentSettings(),
            constraints: { maxWallClockTime: moment.duration({ minute: maxTaskDurationInMinutes }).toISOString() },
        };
    }

    private async getMaxTaskDurationInMinutes(): Promise<number> {
        //    const commonConfig = await this.serviceConfig.getConfigValue('taskConfig');

        return 30;
    }
}
