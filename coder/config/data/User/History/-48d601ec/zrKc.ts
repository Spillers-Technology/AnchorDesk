import { Entity, Column, PrimaryGeneratedColumn } from "typeorm"

@Entity()
export class ClientEntity {
    @PrimaryGeneratedColumn()
    TitleID: number

    @Column({ length: 255 })
    CompanyName: string

    @Column({ length: 10 })
    Acronym: string

    @Column({ length: 100 })
    PrimaryEngagementMgr: string

    @Column({ length: 100 })
    SecondaryEngagementMgr: string

    @Column({ length: 50 })
    MSTAssigned: string

    @Column({ length: 15 })
    HelpDeskNumber: string

    @Column({ length: 50 })
    Agreement: string

    @Column({ length: 50 })
    ContactFirstName: string

    @Column({ length: 50, nullable: true })
    ContactLastName: string

    @Column({ length: 255 })
    ContactEmail: string
}
