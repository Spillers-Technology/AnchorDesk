import { Entity, Column, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Team1ClientList } from './Team1ClientList';
import { Technicians } from './Technicians';

@Entity('Tickets')
export class Tickets {
    @PrimaryColumn({ type: 'int', unsigned: true })
    ticketnumber: number;

    @ManyToOne(() => Team1ClientList, (team) => team.TitleID, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'company' })
    company: Team1ClientList;

    @Column({ type: 'varchar', length: 255 })
    ticketSummary: string;

    @ManyToOne(() => Technicians, (technician) => technician.TechnicianID, { nullable: true })
    @JoinColumn({ name: 'technician' })
    technician: Technicians;

    @Column({ type: 'varchar', length: 255 })
    priority: string;
}
