using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class AddGroupInvitationsAndClientActions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ClientActions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Type = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    TargetUserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    TargetGroupId = table.Column<Guid>(type: "uuid", nullable: true),
                    ManifestId = table.Column<Guid>(type: "uuid", nullable: true),
                    Payload = table.Column<string>(type: "jsonb", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClientActions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ClientActions_AliasVaultUsers_TargetUserId",
                        column: x => x.TargetUserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ClientActions_Groups_TargetGroupId",
                        column: x => x.TargetGroupId,
                        principalTable: "Groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GroupInvitations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    InviterUserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    InviteeUserId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Role = table.Column<int>(type: "integer", nullable: false),
                    VaultManifestId = table.Column<Guid>(type: "uuid", nullable: true),
                    EncryptedVek = table.Column<string>(type: "text", nullable: true),
                    UserGrantKeyId = table.Column<Guid>(type: "uuid", nullable: true),
                    Algorithm = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    State = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    RespondedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupInvitations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GroupInvitations_AliasVaultUsers_InviteeUserId",
                        column: x => x.InviteeUserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GroupInvitations_AliasVaultUsers_InviterUserId",
                        column: x => x.InviterUserId,
                        principalTable: "AliasVaultUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GroupInvitations_Groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "Groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GroupInvitations_UserGrantKeys_UserGrantKeyId",
                        column: x => x.UserGrantKeyId,
                        principalTable: "UserGrantKeys",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ClientActions_TargetGroupId",
                table: "ClientActions",
                column: "TargetGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_ClientActions_TargetUserId",
                table: "ClientActions",
                column: "TargetUserId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupInvitations_InviteeUserId_State",
                table: "GroupInvitations",
                columns: new[] { "InviteeUserId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_GroupInvitations_InviterUserId",
                table: "GroupInvitations",
                column: "InviterUserId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupInvitations_UserGrantKeyId",
                table: "GroupInvitations",
                column: "UserGrantKeyId");

            migrationBuilder.CreateIndex(
                name: "UX_GroupInvitations_Group_Invitee_Pending",
                table: "GroupInvitations",
                columns: new[] { "GroupId", "InviteeUserId" },
                unique: true,
                filter: "\"State\" = 'Pending'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ClientActions");

            migrationBuilder.DropTable(
                name: "GroupInvitations");
        }
    }
}
