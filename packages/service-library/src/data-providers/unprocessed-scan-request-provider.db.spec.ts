// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import 'reflect-metadata';

import { CosmosContainerClient } from 'azure-services';
import { Logger } from 'logger';
import { ItemType, UnProcessedPageScanRequest } from 'storage-documents';
import { Mock } from 'typemoq';
import { DbMockHelper } from '../test-utilities/db-mock-helpers';
import { UnProcessedScanRequestProvider } from './unprocessed-scan-request-provider';

describe('UnProcessedScanRequestProvider.Db', () => {
    // tslint:disable-next-line: mocha-no-side-effect-code
    const dbHelper = new DbMockHelper();

    it('no-op', () => {
        // this test exists to have at least 1 test in the test suite to avoid jest failure, when db test run is not supported.
    });

    // tslint:disable-next-line: mocha-no-side-effect-code
    if (dbHelper.isDbTestSupported()) {
        let testSubject: UnProcessedScanRequestProvider;

        beforeAll(async () => {
            await dbHelper.init('test-db', 'unprocessed-scans');
        }, 30000);

        beforeEach(() => {
            const loggerMock = Mock.ofType<Logger>();
            const cosmosContainerClient = new CosmosContainerClient(
                dbHelper.cosmosClient,
                dbHelper.dbContainer.dbName,
                dbHelper.dbContainer.collectionName,
                loggerMock.object,
            );

            testSubject = new UnProcessedScanRequestProvider(cosmosContainerClient);
        });

        afterEach(async () => {
            await dbHelper.deleteAllDocuments();
        });

        it('stores & retrieve scan results sorted by priority', async () => {
            const request1: UnProcessedPageScanRequest = {
                id: 'id1',
                url: 'url1',
                priority: 10,
                itemType: ItemType.UnProcessedPageScanRequests,
                partitionKey: 'unProcessedScanRequestDocuments',
            };
            const request2: UnProcessedPageScanRequest = {
                id: 'id2',
                url: 'url2',
                priority: 0,
                itemType: ItemType.UnProcessedPageScanRequests,
                partitionKey: 'unProcessedScanRequestDocuments',
            };

            const request3: UnProcessedPageScanRequest = {
                id: 'id3',
                url: 'url3',
                priority: 5,
                itemType: ItemType.UnProcessedPageScanRequests,
                partitionKey: 'unProcessedScanRequestDocuments',
            };

            await testSubject.insertRequests([request1, request2, request3]);

            const itemsInDb = await testSubject.getRequests();

            expect(itemsInDb.item.length).toBe(3);
            expect(itemsInDb.item[0]).toMatchObject(request2);
            expect(itemsInDb.item[1]).toMatchObject(request3);
            expect(itemsInDb.item[2]).toMatchObject(request1);
        });

        it('deletes document', async () => {
            const request1: UnProcessedPageScanRequest = {
                id: 'id1',
                url: 'url1',
                priority: 10,
                itemType: ItemType.UnProcessedPageScanRequests,
                partitionKey: 'unProcessedScanRequestDocuments',
            };
            const request2: UnProcessedPageScanRequest = {
                id: 'id2',
                url: 'url2',
                priority: 0,
                itemType: ItemType.UnProcessedPageScanRequests,
                partitionKey: 'unProcessedScanRequestDocuments',
            };

            const requestNotToBeDeleted: UnProcessedPageScanRequest = {
                id: 'id-not-to-be-deleted',
                url: 'url2',
                priority: 0,
                itemType: ItemType.UnProcessedPageScanRequests,
                partitionKey: 'unProcessedScanRequestDocuments',
            };

            await testSubject.insertRequests([request1, request2, requestNotToBeDeleted]);

            await testSubject.deleteRequests([request1.id, request2.id]);

            const requests = await testSubject.getRequests();

            expect(requests.item.length).toBe(1);
            expect(requests.item[0]).toMatchObject(requestNotToBeDeleted);
        });
    }
});
