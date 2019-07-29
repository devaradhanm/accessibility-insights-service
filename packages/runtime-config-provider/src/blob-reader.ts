// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { BlobClient, BlobServiceClient } from '@azure/storage-blob';
import { inject, injectable } from 'inversify';
import { BlobServiceClientFactory, runtimeConfigIocTypes } from './ioc-types';

@injectable()
export class BlobReader {
    private readonly blobServiceClient: BlobServiceClient;

    constructor(@inject(runtimeConfigIocTypes.BlobServiceClientFactory) blobServiceClientProvider: BlobServiceClientFactory) {
        this.blobServiceClient = blobServiceClientProvider();
    }

    public async getBlobContent(containerName: string, blobName: string): Promise<string> {
        const blobClient = this.getBlobClient(containerName, blobName);

        const response = await blobClient.download(0);

        return this.getContentFromStream(response.readableStreamBody);
    }

    public async getLastModifiedForBlob(containerName: string, blobName: string): Promise<Date> {
        const blobClient = this.getBlobClient(containerName, blobName);

        const blobProps = await blobClient.getProperties();

        return blobProps.lastModified;
    }

    private getBlobClient(containerName: string, blobName: string): BlobClient {
        const containerClient = this.blobServiceClient.getContainerClient(containerName);

        return containerClient.getBlobClient(blobName);
    }

    private async getContentFromStream(readableStream: NodeJS.ReadableStream): Promise<string> {
        return new Promise((resolve, reject) => {
            const chunks: string[] = [];

            readableStream.on('data', (data: unknown) => {
                chunks.push(data.toString());
            });
            readableStream.on('end', () => {
                resolve(chunks.join(''));
            });
            readableStream.on('error', err => {
                reject(err);
            });
        });
    }
}
