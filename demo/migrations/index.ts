import { CreateAccounts1800000000001 } from './1800000000001-CreateAccounts';
import { CreateProducts1800000000002 } from './1800000000002-CreateProducts';
import { CreateOrders1800000000003 } from './1800000000003-CreateOrders';
import { CreateOrderItems1800000000004 } from './1800000000004-CreateOrderItems';
import { AddContacts1800000000005 } from './1800000000005-AddContacts';
import { AddDocumentFields1800000000006 } from './1800000000006-AddDocumentFields';
import { AddAuditDefaults1800000000007 } from './1800000000007-AddAuditDefaults';
import { BackfillContacts1800000000008 } from './1800000000008-BackfillContacts';
import { RequireEmail1800000000009 } from './1800000000009-RequireEmail';
import { UniqueEmails1800000000010 } from './1800000000010-UniqueEmails';
import { OrderLookupIndexes1800000000011 } from './1800000000011-OrderLookupIndexes';
import { CompositeItemKey1800000000012 } from './1800000000012-CompositeItemKey';
import { UniqueProductNames1800000000013 } from './1800000000013-UniqueProductNames';
import { ExpandMoneyStorage1800000000014 } from './1800000000014-ExpandMoneyStorage';
import { BackfillMoneyStorage1800000000015 } from './1800000000015-BackfillMoneyStorage';
import { RenameCatalog1800000000016 } from './1800000000016-RenameCatalog';
import { MigrateDisplayNames1800000000017 } from './1800000000017-MigrateDisplayNames';
import { MaterializeOrderTotals1800000000018 } from './1800000000018-MaterializeOrderTotals';
import { NativeQuantityValidation1800000000019 } from './1800000000019-NativeQuantityValidation';
import { GraphProjection1800000000020 } from './1800000000020-GraphProjection';
import { ReplaceOrderIndexes1800000000021 } from './1800000000021-ReplaceOrderIndexes';
import { ReplaceCompositeKey1800000000022 } from './1800000000022-ReplaceCompositeKey';
import { ArchiveAccountSnapshot1800000000023 } from './1800000000023-ArchiveAccountSnapshot';
import { ContractMoneyStorage1800000000024 } from './1800000000024-ContractMoneyStorage';

export const migrations = [
  CreateAccounts1800000000001,
  CreateProducts1800000000002,
  CreateOrders1800000000003,
  CreateOrderItems1800000000004,
  AddContacts1800000000005,
  AddDocumentFields1800000000006,
  AddAuditDefaults1800000000007,
  BackfillContacts1800000000008,
  RequireEmail1800000000009,
  UniqueEmails1800000000010,
  OrderLookupIndexes1800000000011,
  CompositeItemKey1800000000012,
  UniqueProductNames1800000000013,
  ExpandMoneyStorage1800000000014,
  BackfillMoneyStorage1800000000015,
  RenameCatalog1800000000016,
  MigrateDisplayNames1800000000017,
  MaterializeOrderTotals1800000000018,
  NativeQuantityValidation1800000000019,
  GraphProjection1800000000020,
  ReplaceOrderIndexes1800000000021,
  ReplaceCompositeKey1800000000022,
  ArchiveAccountSnapshot1800000000023,
  ContractMoneyStorage1800000000024,
];
