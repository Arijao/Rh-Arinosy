-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "gender" TEXT,
    "salary" REAL,
    "useGroupSalary" BOOLEAN NOT NULL DEFAULT true,
    "groupId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'actif',
    "departureDate" TEXT,
    "dateAdded" TEXT NOT NULL,
    "faceDescriptors" TEXT,
    "faceEnrolled" BOOLEAN NOT NULL DEFAULT false,
    "faceEnrollmentDate" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Employee_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Employee" ("createdAt", "dateAdded", "departureDate", "faceDescriptors", "faceEnrolled", "faceEnrollmentDate", "gender", "groupId", "id", "name", "position", "salary", "status", "useGroupSalary") SELECT "createdAt", "dateAdded", "departureDate", "faceDescriptors", "faceEnrolled", "faceEnrollmentDate", "gender", "groupId", "id", "name", "position", "salary", "status", "useGroupSalary" FROM "Employee";
DROP TABLE "Employee";
ALTER TABLE "new_Employee" RENAME TO "Employee";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
