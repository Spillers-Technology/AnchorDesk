import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('Team1ClientList')
export class Team1ClientList {
    @PrimaryGeneratedColumn('increment', { unsigned: true })
    TitleID: number;

    @Column({ type: 'varchar', length: 255 })
    CompanyName: string;

    @Column({ type: 'varchar', length: 10 })
    Acronym: string;

    @Column({ type: 'varchar', length: 100 })
    PrimaryEngagementMgr: string;

    @Column({ type: 'varchar', length: 100 })
    SecondaryEngagementMgr: string;

    @Column({ type: 'varchar', length: 50 })
    MSTAssigned: string;

    @Column({ type: 'varchar', length: 15 })
    HelpDeskNumber: string;

    @Column({ type: 'varchar', length: 50 })
    Agreement: string;

    @Column({ type: 'varchar', length: 50 })
    ContactFirstName: string;

    @Column({ type: 'varchar', length: 50, nullable: true })
    ContactLastName: string;

    @Column({ type: 'varchar', length: 255 })
    ContactEmail: string;
}
