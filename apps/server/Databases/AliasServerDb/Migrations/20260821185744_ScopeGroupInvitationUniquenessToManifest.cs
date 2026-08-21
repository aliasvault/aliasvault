using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AliasServerDb.Migrations
{
    /// <inheritdoc />
    public partial class ScopeGroupInvitationUniquenessToManifest : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_GroupInvitations_Group_Invitee_Pending",
                table: "GroupInvitations");

            migrationBuilder.CreateIndex(
                name: "IX_GroupInvitations_GroupId",
                table: "GroupInvitations",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "UX_GroupInvitations_Manifest_Invitee_Pending",
                table: "GroupInvitations",
                columns: new[] { "VaultManifestId", "InviteeUserId" },
                unique: true,
                filter: "\"State\" = 'Pending'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_GroupInvitations_GroupId",
                table: "GroupInvitations");

            migrationBuilder.DropIndex(
                name: "UX_GroupInvitations_Manifest_Invitee_Pending",
                table: "GroupInvitations");

            migrationBuilder.CreateIndex(
                name: "UX_GroupInvitations_Group_Invitee_Pending",
                table: "GroupInvitations",
                columns: new[] { "GroupId", "InviteeUserId" },
                unique: true,
                filter: "\"State\" = 'Pending'");
        }
    }
}
