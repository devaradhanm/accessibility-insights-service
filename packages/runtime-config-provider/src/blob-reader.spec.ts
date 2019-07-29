// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import 'reflect-metadata';

import { BlobClient, BlobServiceClient, ContainerClient, Models } from '@azure/storage-blob';
import { Stream } from 'stream';
import { IMock, Mock } from 'typemoq';
import { BlobReader } from './blob-reader';
import { BlobServiceClientFactory } from './ioc-types';

// tslint:disable: no-null-keyword

describe(BlobReader, () => {
    let testSubject: BlobReader;
    let blobServiceClientMock: IMock<BlobServiceClient>;
    let blobServiceClientFactoryStub: BlobServiceClientFactory;
    let containerClientMock: IMock<ContainerClient>;
    let blobClientMock: IMock<BlobClient>;

    const containerName = 'container1';
    const blobName = 'blob1';

    beforeEach(() => {
        blobServiceClientMock = Mock.ofType(BlobServiceClient);
        blobServiceClientFactoryStub = () => blobServiceClientMock.object;

        containerClientMock = Mock.ofType(ContainerClient);
        blobClientMock = Mock.ofType(BlobClient);

        blobServiceClientMock.setup(s => s.getContainerClient(containerName)).returns(() => containerClientMock.object);
        containerClientMock.setup(s => s.getBlobClient(blobName)).returns(() => blobClientMock.object);

        testSubject = new BlobReader(blobServiceClientFactoryStub);
    });

    describe('getBlobContent', () => {
        it('downloads blob content as string', async () => {
            const dataChunks = ['chunk1', 'chunk2'];
            const readableStream = getReadableStreamForDataChunks(dataChunks);

            setupDownloadBlobCall(readableStream);

            const content = await testSubject.getBlobContent(containerName, blobName);

            expect(content).toBe(dataChunks.join(''));
        });

        it('throws if unable to read blob content', async () => {
            const readableStream = getErrorReadableStream();

            setupDownloadBlobCall(readableStream);

            await expect(testSubject.getBlobContent(containerName, blobName)).rejects.toBeDefined();
        });
    });

    describe('gets the last modified time of blob', () => {
        it('foo', async () => {}, 30000);
    });

    function setupDownloadBlobCall(readableStream: NodeJS.ReadableStream): void {
        const response: Models.BlobDownloadResponse = ({
            readableStreamBody: readableStream,
        } as unknown) as Models.BlobDownloadResponse;

        blobClientMock
            .setup(async s => s.download(0))
            .returns(async () => {
                return response;
            });
    }

    function getReadableStreamForDataChunks(chunks: string[]): NodeJS.ReadableStream {
        const readableStream = new Stream.Readable();
        chunks.forEach(chunk => {
            readableStream.push(chunk);
        });
        readableStream.push(null);

        return readableStream;
    }

    function getErrorReadableStream(): NodeJS.ReadableStream {
        return new Stream.Readable();
    }
});
